# Развёртывание и эксплуатация «Опросы СПГО»

Документ для передачи системы в эксплуатацию: первичная установка на сервер, повседневная работа, обновления, резервное копирование и типовые сбои.

Краткая справка по локальной разработке — в корневом [`README.md`](../README.md).

---

## 1. Что это за система

Веб-приложение для проведения опросов с планшета/телефона:

- конструктор опросов (админ / редактор);
- проведение опросов с аудиозаписью и геометкой места;
- результаты: ответы, аудио, карта (OpenStreetMap), выгрузка CSV;
- роли: администратор, редактор, пользователь.

**Стек:** Node.js (Express) + React (Vite) + MariaDB. В production один процесс Node.js отдаёт и API (`/api/...`), и собранный фронтенд из `client/dist`. Снаружи обычно стоит **nginx** (HTTPS + прокси).

---

## 2. Типовая схема на сервере

```
Интернет → nginx :443 (HTTPS)
              ├─ Basic Auth (опциональный «шлюз»)
              ├─ /.well-known/acme-challenge/ → /var/www/certbot (Let's Encrypt)
              └─ остальное → http://127.0.0.1:3000 (PM2: oprosy)
                              └─ MariaDB :3306
```

| Элемент | Обычно |
|---------|--------|
| Каталог приложения | `/var/www/oprosy` |
| Конфиг окружения | `/var/www/oprosy/.env` |
| Процесс | PM2, имя `oprosy` |
| Аудиозаписи | `/var/www/oprosy/server/uploads/audio/` |
| Бэкапы на сервере | `/var/backups/oprosy/` |
| Лог обновления SSL | `/var/log/oprosy-certbot-renew.log` |
| Скрипт обновления SSL | `/usr/local/bin/oprosy-certbot-renew` |
| Cron SSL | `/etc/cron.d/oprosy-certbot` (раз в 3 дня в 03:15) |

Порт **3000** наружу **не открывать** — только локально для nginx.

---

## 3. Первичное развёртывание (с нуля)

ОС: Ubuntu / Debian. Нужны права `root` или `sudo`.

### 3.1. Пакеты

```bash
sudo apt update
sudo apt install -y curl git nginx mariadb-server apache2-utils ufw
# Node.js 20 LTS (NodeSource или другой проверенный способ)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Для SSL по **домену** достаточно пакета `certbot`.  
Для SSL по **IP** (shortlived Let's Encrypt) нужен Certbot через snap ≥ 5.4 — см. раздел 5.

### 3.2. База данных

```bash
sudo mysql
```

```sql
CREATE DATABASE IF NOT EXISTS oprosy
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'oprosy'@'localhost' IDENTIFIED BY 'НАДЁЖНЫЙ_ПАРОЛЬ_БД';
GRANT ALL PRIVILEGES ON oprosy.* TO 'oprosy'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 3.3. Код приложения

```bash
sudo mkdir -p /var/www/oprosy
sudo chown -R "$USER":"$USER" /var/www/oprosy
cd /var/www/oprosy
git clone https://github.com/einarrharaldsson-tech/oprosy_spgo.git .
# или распакуйте релизный архив в /var/www/oprosy
```

### 3.4. Файл `.env`

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Минимум для production:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=oprosy
DB_PASSWORD=НАДЁЖНЫЙ_ПАРОЛЬ_БД
DB_NAME=oprosy

JWT_SECRET=длинная_случайная_строка_openssl_rand_hex_32
PORT=3000
NODE_ENV=production
CLIENT_URL=https://ВАШ_ДОМЕН_ИЛИ_IP
BASE_PATH=
MAX_AUDIO_MB=50
```

`JWT_SECRET` сгенерируйте так:

```bash
openssl rand -hex 32
```

Опционально:

| Переменная | Зачем |
|------------|--------|
| `DADATA_API_KEY` | Подсказки адресов в вопросах типа «адрес» |
| `AITUNNEL_API_KEY` | Транскрибация аудио → DOC в результатах ([AITunnel](https://aitunnel.ru/docs/speech-to-text), модель по умолчанию `qwen3-asr-1.7b`) |

### 3.5. Установка зависимостей, схема БД, сборка

```bash
cd /var/www/oprosy
npm install
npm run install:all
npm run db:init
npm run build
```

`db:init` создаёт таблицы и первого администратора:

- логин: `admin`
- пароль: `admin`

**Сразу после первого входа смените пароль** в разделе «Пользователи».

### 3.6. Запуск через PM2

```bash
cd /var/www/oprosy
pm2 start server/src/index.js --name oprosy
pm2 save
pm2 startup
# выполните строку, которую выведет pm2 startup
```

Проверка:

```bash
curl -sS http://127.0.0.1:3000/api/health
# ожидается: {"ok":true,...}
```

### 3.7. nginx

Пример с доменом и Basic Auth — в [`README.md`](../README.md) (шаг 6) и в `deploy/nginx/auth.conf.example`.

Обязательно:

```nginx
client_max_body_size 64m;
```

(иначе длинные аудиозаписи не загрузятся).

ACMЕ-проверку Let's Encrypt **не закрывайте** Basic Auth:

```nginx
location ^~ /.well-known/acme-challenge/ {
    root /var/www/certbot;
    default_type "text/plain";
}
```

Фаервол:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### 3.8. Два уровня входа

1. **HTTP Basic Auth (шлюз)** — браузер спрашивает логин/пароль до страницы приложения.  
   Файл паролей обычно: `/etc/nginx/.htpasswd`.  
   Создать: `sudo htpasswd -c /etc/nginx/.htpasswd gate`.
2. **Вход в приложение** — логин/пароль пользователей из раздела «Пользователи» (JWT).

Это **разные** учётки. Шлюз можно отключить, убрав `auth_basic` из nginx.

---

## 4. Повседневная эксплуатация

### 4.1. Статус и логи

```bash
pm2 status
pm2 logs oprosy --lines 100
curl -sS http://127.0.0.1:3000/api/health
sudo systemctl status nginx mariadb
```

Внешняя проверка (подставьте URL):

```bash
curl -sS https://ВАШ_ХОСТ/api/health
```

`/api/health` обычно **без** Basic Auth. Главная страница при включённом шлюзе отвечает `401` без логина — это нормально.

### 4.2. Перезапуск

```bash
pm2 restart oprosy
sudo systemctl reload nginx
```

### 4.3. После перезагрузки сервера

PM2 и nginx должны подняться сами (`pm2 startup`, `systemctl enable`). Если приложение offline:

```bash
pm2 resurrect   # или: cd /var/www/oprosy && pm2 start server/src/index.js --name oprosy
sudo systemctl start nginx mariadb
```

### 4.4. Роли в приложении

| Роль | Что может |
|------|-----------|
| Администратор | Пользователи, конструктор, проведение, результаты, архив |
| Редактор | Конструктор, проведение, результаты |
| Пользователь | Только проведение опросов, к которым выдан доступ |

### 4.5. Проведение опросов (поле)

- Нужен **HTTPS** (иначе микрофон и геолокация в браузере часто недоступны).
- При старте проведения браузер запросит доступ к **микрофону** и **геолокации**.
- Отказ от геолокации **не блокирует** опрос — просто не будет точки на карте в результатах.
- При нестабильной сети проведение сохраняется в **локальную очередь** на устройстве и догружается при появлении связи (раздел «Очередь» / индикаторы на экране проведения).

### 4.6. Результаты

В карточке проведения:

- ответы;
- аудио (прослушивание и кнопка «Скачать аудио»);
- карта места (если GPS был получен);
- выгрузка всех проведений: **Скачать CSV**.

---

## 5. HTTPS и сертификаты

### 5.1. Вариант с доменом (предпочтительно)

Обычный Let's Encrypt (~90 дней), автообновление certbot:

```bash
sudo certbot --nginx -d oprosy.example.com
sudo certbot renew --dry-run
```

DNS A-запись должна указывать на сервер **до** выпуска сертификата.

### 5.2. Вариант с IP (как на части стендов)

Для доступа по голому IP Let's Encrypt выдаёт **короткий** сертификат (~6–7 дней), профиль `shortlived`.

На сервере уже может быть настроено:

- скрипт: `/usr/local/bin/oprosy-certbot-renew`
- cron: каждые **3 дня** в 03:15 → `/etc/cron.d/oprosy-certbot`
- лог: `/var/log/oprosy-certbot-renew.log`

Проверить срок:

```bash
sudo openssl x509 -in /etc/letsencrypt/live/ВАШ_IP/fullchain.pem -noout -dates
sudo certbot certificates
```

Ручное обновление:

```bash
sudo /usr/local/bin/oprosy-certbot-renew
# или
sudo certbot renew
sudo systemctl reload nginx
```

**Важно:** если VPS выключен дольше срока сертификата, после включения запустите обновление вручную. Первичная настройка IP-сертификата — скрипт `scripts/vps-setup-le-ip.js` (нужны `VPS_PASSWORD` / доступ по SSH).

---

## 6. Обновление версии

### 6.1. С GitHub

```bash
cd /var/www/oprosy
pm2 stop oprosy   # по желанию, на короткое окно

git pull origin main

npm install --omit=dev
npm run install:all
npm run build
npm run db:init   # безопасно: досоздаёт недостающие колонки/таблицы

pm2 restart oprosy
curl -sS http://127.0.0.1:3000/api/health
```

Перед обновлением желательно бэкап (раздел 7).

### 6.2. Что не затирать при ручной заливке файлов

| Путь | Не удалять |
|------|------------|
| `.env` | секреты и настройки |
| `server/uploads/` | аудиозаписи |
| `/etc/nginx/` , `.htpasswd` | веб-конфиг и шлюз |
| `/etc/letsencrypt/` | сертификаты |

После замены фронта сделайте жёсткое обновление страницы в браузере (кэш).

---

## 7. Резервное копирование и восстановление

### 7.1. Что копировать

1. База MariaDB (`oprosy`).
2. Каталог `server/uploads/` (аудио).
3. Файл `.env`.
4. При необходимости — конфиги nginx и `.htpasswd`.

### 7.2. Дамп БД

```bash
mkdir -p /var/backups/oprosy
mysqldump -u oprosy -p --single-transaction --routines --triggers oprosy \
  > /var/backups/oprosy/oprosy-db-$(date +%F).sql
```

Архив кода без `node_modules` (пример):

```bash
cd /var/www
tar -czf /var/backups/oprosy/oprosy-code-$(date +%F).tgz \
  --exclude=oprosy/node_modules \
  --exclude=oprosy/server/node_modules \
  --exclude=oprosy/client/node_modules \
  --exclude=oprosy/client/dist \
  oprosy
```

Рекомендуется хранить копии **вне** этого VPS (другой диск / облако).

### 7.3. Восстановление БД

```bash
mysql -u oprosy -p oprosy < /var/backups/oprosy/oprosy-db-YYYY-MM-DD.sql
pm2 restart oprosy
```

---

## 8. Типовые проблемы

| Симптом | Что сделать |
|---------|-------------|
| Сайт не открывается | `pm2 status`, `systemctl status nginx`, `curl 127.0.0.1:3000/api/health` |
| Предупреждение браузера про SSL | Сертификат истёк — раздел 5; для IP — запустить renew |
| 401 и форма шлюза | Нужен логин Basic Auth (не путать с `admin` приложения) |
| Не пишет микрофон / нет гео | Нужен HTTPS; разрешения в браузере; на планшете — службы геолокации |
| Не сохраняется проведение с аудио | `client_max_body_size` в nginx; место на диске; `pm2 logs` |
| Белый экран после обновления | Не собран `client/dist` → `npm run build`; сброс кэша браузера |
| Ошибка входа / 500 | `.env`, MariaDB запущена, `pm2 logs oprosy` |
| Порт 3000 занят | `pm2 list`, `ss -tlnp \| grep 3000` |

---

## 9. Безопасность (чеклист при передаче)

- [ ] Сменён пароль `admin` и пароли Basic Auth
- [ ] В `.env` стоят уникальные `JWT_SECRET` и пароль БД; права на файл `600`
- [ ] `.env` и `.htpasswd` **не** в git
- [ ] `NODE_ENV=production`
- [ ] HTTPS включён, порт 3000 закрыт снаружи
- [ ] Настроены бэкапы БД и `uploads`
- [ ] Известны ответственные за VPS, DNS и продление SSL
- [ ] Переданы доступы: SSH, панель хостинга, GitHub (при необходимости), шлюз, админ приложения — **отдельным защищённым каналом**, не в этом файле

---

## 10. Полезные пути в репозитории

| Путь | Назначение |
|------|------------|
| [`README.md`](../README.md) | Общее описание, локальная разработка, шаблоны nginx/Apache |
| [`database/schema.sql`](../database/schema.sql) | Схема БД |
| [`server/src/scripts/initDb.js`](../server/src/scripts/initDb.js) | Инициализация / миграции |
| [`deploy/nginx/`](../deploy/nginx/) | Пример Basic Auth для nginx |
| [`scripts/vps-setup-le-ip.js`](../scripts/vps-setup-le-ip.js) | Выпуск SSL на IP + cron |
| [`scripts/ssh-update-certbot-cron.mjs`](../scripts/ssh-update-certbot-cron.mjs) | Обновление cron SSL |
| [`.env.example`](../.env.example) | Шаблон переменных окружения |

---

## 11. Контакты при передаче

Заполните при сдаче в эксплуатацию:

| Роль | ФИО / организация | Контакт |
|------|-------------------|---------|
| Разработка / сопровождение кода | | |
| Администрирование сервера | | |
| Заказчик / владельцы данных | | |

Репозиторий: `https://github.com/einarrharaldsson-tech/oprosy_spgo`

Версия приложения отображается в подвале сайта (footer).
