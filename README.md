# oprosy_spgo

Опросы СПГО — веб-приложение для проведения опросов: конструктор вопросов, роли доступа, проведение с планшета/телефона.

## Стек

- **Backend:** Node.js, Express, JWT, bcrypt
- **БД:** MariaDB (mysql2)
- **Frontend:** React + Vite, адаптивная вёрстка

В production Node.js отдаёт и API (`/api/...`), и собранный фронтенд из `client/dist` одним процессом.

## Роли

| Роль | Возможности |
|------|-------------|
| **Администратор** | Пользователи, роли, конструктор, проведение, архив → «История» |
| **Редактор** | Конструктор, проведение, результаты |
| **Пользователь** | Только проведение опросов, к которым выдан доступ |

## Разделы интерфейса

- **Опросы** — список доступных активных опросов и проведение
- **Конструктор** (админ/редактор) — создание вопросов: варианты (несколько или один), выпадающий список или текстовое поле; назначение доступа пользователям
- **Пользователи** (админ) — учётные записи и роли
- **История** (админ) — архивные опросы

После первого сохранённого ответа состав вопросов опроса фиксируется. Название, доступ и статус по-прежнему можно менять.

### Аудиозапись при проведении

Каждое **проведение** опроса (один респондент) сохраняется отдельно:

- ответы на вопросы;
- пометка о респонденте;
- **аудиозапись голоса** с микрофона планшета/телефона.

Один шаблон опроса → много проведений (10–30 и более). В разделе **Результаты** у каждого проведения свой номер, ответы и плеер для прослушивания записи.

При **архивации** опрос уходит в «Историю» вместе со всеми проведениями и аудиофайлами (файлы лежат в `server/uploads/audio/survey_<id>/`).

После обновления кода выполните миграцию БД:

```bash
npm run db:init
```

На сервере увеличьте лимит тела запроса (nginx: `client_max_body_size 64m;`) — см. раздел установки.

---

## Локальная разработка

### 1. Требования

- Node.js 20+ (рекомендуется LTS)
- MariaDB 10.6+ (или совместимый MySQL 8)

### 2. MariaDB

```sql
CREATE DATABASE IF NOT EXISTS oprosy
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'oprosy'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON oprosy.* TO 'oprosy'@'localhost';
FLUSH PRIVILEGES;
```

### 3. Конфиг

```bash
copy .env.example .env
```

Укажите в `.env` доступ к БД и `JWT_SECRET`.

### 4. Установка и схема

```bash
npm install
npm run install:all
npm run db:init
```

Скрипт применит `database/schema.sql` и создаст админа:

- логин: `admin`
- пароль: `admin`

Смените пароль после первого входа.

### 5. Запуск в режиме разработки

```bash
npm run dev
```

- UI: http://localhost:5173  
- API: http://localhost:3000  

Если порты заняты (`EADDRINUSE`), остановите старый процесс или завершите PID на портах 3000/5173.

---

## Установка на сервер (production)

Ниже — типичный сценарий для VPS/выделенного сервера (Ubuntu/Debian). На других ОС шаги те же по смыслу: Node.js, MariaDB, `.env`, сборка, процесс-менеджер, reverse proxy.

### Что понадобится на сервере

| Компонент | Назначение |
|-----------|------------|
| Node.js 20+ LTS | Запуск API и раздача фронтенда |
| MariaDB | Хранение пользователей, опросов, ответов |
| nginx (рекомендуется) | HTTPS, прокси на Node.js |
| PM2 или systemd | Автозапуск приложения после перезагрузки |
| Домен (желательно) | Удобный URL и сертификат Let's Encrypt |

Минимально достаточно одного Node.js-процесса на порту (например `3000`), но для интернета лучше nginx + HTTPS.

### Общая схема

```
Браузер → https://oprosy.example.com (nginx:443)
                ↓ proxy
         http://127.0.0.1:3000 (Node.js)
                ↓
         MariaDB :3306
```

Фронтенд и API живут на одном origin: страницы с диска `client/dist`, запросы на `/api/...`.

---

### Шаг 1. Подготовка сервера

Обновление и базовые пакеты (Ubuntu/Debian):

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential
```

#### Node.js 20 LTS (через NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

#### MariaDB

```bash
sudo apt install -y mariadb-server
sudo mysql_secure_installation
```

Войдите в консоль БД:

```bash
sudo mysql
```

Создайте базу и пользователя (пароль придумайте свой и сохраните):

```sql
CREATE DATABASE oprosy
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'oprosy'@'localhost' IDENTIFIED BY 'СИЛЬНЫЙ_ПАРОЛЬ_БД';
GRANT ALL PRIVILEGES ON oprosy.* TO 'oprosy'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Проверка:

```bash
mysql -u oprosy -p -h 127.0.0.1 oprosy -e "SELECT 1;"
```

---

### Шаг 2. Загрузка проекта на сервер

Вариант A — git:

```bash
sudo mkdir -p /var/www/oprosy
sudo chown $USER:$USER /var/www/oprosy
cd /var/www/oprosy
git clone <URL_ВАШЕГО_РЕПОЗИТОРИЯ> .
```

Вариант B — архив (SFTP/SCP): загрузите файлы проекта в `/var/www/oprosy`  
**не загружайте** локальные `node_modules`, `.env` с dev-паролями и лишние артефакты.

Структура должна содержать:

```
oprosy/
  package.json
  .env.example
  database/schema.sql
  server/
  client/
```

---

### Шаг 3. Файл окружения `.env`

```bash
cd /var/www/oprosy
cp .env.example .env
nano .env
```

Пример production-конфига:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=oprosy
DB_PASSWORD=СИЛЬНЫЙ_ПАРОЛЬ_БД
DB_NAME=oprosy

JWT_SECRET=длинная_случайная_строка_не_меньше_32_символов
PORT=3000
NODE_ENV=production

# В production фронт отдаётся тем же Node.js — CLIENT_URL почти не нужен
CLIENT_URL=https://oprosy.example.com
```

Как сгенерировать `JWT_SECRET`:

```bash
openssl rand -hex 32
```

Права на файл:

```bash
chmod 600 .env
```

---

### Шаг 4. Установка зависимостей, сборка, инициализация БД

Все команды — из корня проекта `/var/www/oprosy`:

```bash
cd /var/www/oprosy

# зависимости корня (concurrently и скрипты) + server + client
npm install --omit=dev
npm run install:all

# сборка React → client/dist
npm run build

# таблицы + пользователь admin/admin (только первый раз)
npm run db:init
```

Ожидаемый вывод `db:init`:

```text
Schema applied.
Created default admin: login=admin, password=admin
Done.
```

Если админ уже есть, скрипт напишет `Admin user already exists, skip seed.` — это нормально.

**Важно:** сразу после первого входа смените пароль `admin` в разделе «Пользователи».

Проверка ручным запуском:

```bash
NODE_ENV=production npm start
```

В другом терминале:

```bash
curl http://127.0.0.1:3000/api/health
# {"ok":true}
```

В браузере временно: `http://IP_СЕРВЕРА:3000/` (если порт открыт). Остановите процесс: `Ctrl+C`.

---

### Шаг 5. Автозапуск через PM2 (рекомендуется)

```bash
sudo npm install -g pm2
cd /var/www/oprosy
pm2 start server/src/index.js --name oprosy
pm2 save
pm2 startup
```

Команда `pm2 startup` выведет строку вида `sudo env PATH=...` — выполните её.

Полезные команды:

```bash
pm2 status
pm2 logs oprosy
pm2 restart oprosy
```

#### Альтернатива: systemd

Файл `/etc/systemd/system/oprosy.service`:

```ini
[Unit]
Description=Oprosy survey app
After=network.target mariadb.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/oprosy/server
EnvironmentFile=/var/www/oprosy/.env
ExecStart=/usr/bin/node /var/www/oprosy/server/src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data:www-data /var/www/oprosy
sudo systemctl daemon-reload
sudo systemctl enable --now oprosy
sudo systemctl status oprosy
```

---

### Шаг 6. nginx + HTTPS

Установка:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Сайт `/etc/nginx/sites-available/oprosy`:

```nginx
server {
    listen 80;
    server_name oprosy.example.com;

    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Включите конфиг и получите сертификат:

```bash
sudo ln -s /etc/nginx/sites-available/oprosy /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

sudo certbot --nginx -d oprosy.example.com
```

DNS A-запись домена должна указывать на IP сервера **до** запуска certbot.

Фаервол (если включён ufw):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Порт `3000` наружу открывать не нужно — nginx ходит на него локально.

---

### Шаг 6.1. Дополнительная веб-авторизация (htaccess / Basic Auth)

Помимо логина в самом приложении (`admin` / пользователи), можно включить **второй «замок»** на уровне веб-сервера: браузер сначала спрашивает логин/пароль HTTP Basic Auth, и только потом открывается страница входа в «Опросы».

```
Пользователь → [Basic Auth: веб-сервер] → [JWT: приложение] → работа
```

Готовые шаблоны в репозитории:

| Файл | Назначение |
|------|------------|
| `deploy/apache/.htaccess.example` | `.htaccess` + прокси на Node.js |
| `deploy/apache/vhost.conf.example` | VirtualHost Apache с SSL и Basic Auth |
| `deploy/nginx/auth.conf.example` | фрагмент `auth_basic` для nginx |

Файл `.htpasswd` **не храните в git** (уже в `.gitignore`).

#### Создание паролей (Linux)

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /var/www/oprosy/.htpasswd gate_user
# добавить ещё пользователя без перезаписи файла:
sudo htpasswd /var/www/oprosy/.htpasswd second_user

sudo chmod 640 /var/www/oprosy/.htpasswd
sudo chown root:www-data /var/www/oprosy/.htpasswd
```

`gate_user` — это **отдельный** логин от `admin` в приложении. Пароли могут быть разными.

#### Вариант A: Apache + `.htaccess`

1. Убедитесь, что Apache стоит **перед** Node.js (reverse proxy), а не наоборот.
2. Включите модули:

```bash
sudo a2enmod proxy proxy_http headers auth_basic authn_file rewrite ssl
sudo systemctl reload apache2
```

3. Скопируйте и отредактируйте шаблон:

```bash
cp deploy/apache/.htaccess.example /var/www/oprosy/public/.htaccess
nano /var/www/oprosy/public/.htaccess
```

В `AuthUserFile` укажите **абсолютный** путь к `.htpasswd`, например `/var/www/oprosy/.htpasswd`.

4. Либо настройте целиком VirtualHost — см. `deploy/apache/vhost.conf.example` (удобнее для HTTPS).

Проверка:

```bash
curl -I https://oprosy.example.com/
# ожидается HTTP 401 без заголовка Authorization

curl -I -u gate_user:ПАРОЛЬ https://oprosy.example.com/
# ожидается HTTP 200 и HTML приложения
```

#### Вариант B: nginx + `auth_basic` (аналог htaccess)

Если используете nginx (как в шаге 6), добавьте Basic Auth в `location /`:

```bash
sudo htpasswd -c /etc/nginx/.htpasswd gate_user
sudo chmod 640 /etc/nginx/.htpasswd
sudo chown root:www-data /etc/nginx/.htpasswd
```

Фрагмент `/etc/nginx/sites-available/oprosy` (внутри `server { ... }`):

```nginx
server {
    listen 443 ssl;
    server_name oprosy.example.com;

    # ... ssl_certificate ...

    client_max_body_size 64m;

    location / {
        auth_basic "Oprosy — доступ по паролю";
        auth_basic_user_file /etc/nginx/.htpasswd;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

#### Панель хостинга (ISPmanager, cPanel и т.п.)

Часто есть пункт **«Защита каталога паролем»** / **Directory Privacy** — это тот же Basic Auth. Включите для корня сайта или каталога, куда смотрит домен. Node.js при этом должен работать за Apache/nginx, как reverse proxy.

#### Важно

- Basic Auth **не заменяет** вход в приложение — это дополнительный барьер.
- На **локальной разработке** (`npm run dev`) `.htaccess` не используется; включайте только на production-сервере.
- Не открывайте порт `3000` в интернет, если Basic Auth настроен только на nginx/Apache — иначе обход возможен напрямую.
- Для API и SPA достаточно защитить весь `location /` — браузер сам отправляет `Authorization: Basic` на те же origin-запросы `/api/...` после первого ввода пароля.

---

### Шаг 7. Проверка после установки

1. Откройте `https://oprosy.example.com`
2. Войдите: `admin` / `admin`
3. Смените пароль администратора
4. Создайте тестового пользователя и опрос, проверьте проведение с телефона/планшета

Диагностика:

```bash
# приложение живо?
curl -s https://oprosy.example.com/api/health

# логи
pm2 logs oprosy
# или
sudo journalctl -u oprosy -f

# БД
mysql -u oprosy -p -e "USE oprosy; SHOW TABLES; SELECT id, login, role FROM users;"
```

---

### Обновление версии на сервере

```bash
cd /var/www/oprosy
# git pull   или загрузка новых файлов

npm install --omit=dev
npm run install:all
npm run build
pm2 restart oprosy
```

`npm run db:init` при обновлении обычно **не нужен** (он идемпотентен для схемы/`IF NOT EXISTS`, но повторно админа не создаст). Изменения схемы между версиями, если появятся, будут описаны отдельно.

---

### Частые ошибки на сервере

| Симптом | Что проверить |
|---------|----------------|
| «Ошибка входа» / 500 | `.env`, доступ к MariaDB, `pm2 logs` |
| Белый экран / 404 статики | Не выполнен `npm run build`, нет `client/dist` |
| `EADDRINUSE :3000` | Уже запущен другой экземпляр — `pm2 list` / `ss -tlnp \| grep 3000` |
| `ECONNREFUSED :3306` | Служба MariaDB не запущена: `sudo systemctl status mariadb` |
| API ок, сайт нет | nginx не проксирует или неверный `server_name` |
| 401 на сайте, в приложение не пускает | Неверный логин Basic Auth или путь к `.htpasswd` |
| Basic Auth обходится | Порт `3000` открыт наружу — закройте, оставьте только 80/443 |
| После деплоя старый UI | Жёсткое обновление кэша браузера / CDN |

---

### Безопасность (краткий чеклист)

- [ ] `NODE_ENV=production`
- [ ] Уникальный длинный `JWT_SECRET`
- [ ] Сильный пароль БД, пользователь БД только с правами на `oprosy.*`
- [ ] Сменён пароль `admin` после первого входа
- [ ] `.env` не в git, права `600`
- [ ] HTTPS через nginx/certbot
- [ ] (опционально) HTTP Basic Auth через `.htaccess` / nginx `auth_basic`
- [ ] Порт Node.js не торчит в интернет без необходимости
- [ ] Регулярные бэкапы БД:

```bash
mysqldump -u oprosy -p oprosy > oprosy-$(date +%F).sql
```
