import { APP_VERSION_LABEL } from '../version';

export default function AppFooter() {
  return (
    <footer className="app-footer">
      <p className="app-footer__org">Сергиево - Посадский городской округ</p>
      <p className="app-footer__meta">
        Все права защищены. Разработано: <span className="app-footer__team">AdmSP Tech Team</span>
      </p>
      <p className="app-footer__version">{APP_VERSION_LABEL}</p>
    </footer>
  );
}
