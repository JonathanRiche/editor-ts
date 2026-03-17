import { render } from 'solid-js/web';
import App from './App';
import './styles.css';

const applyDesktopUiScale = (): void => {
  const scale = window.__EDITORTS_DESKTOP__?.uiScale;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale === 1) {
    return;
  }

  document.documentElement.style.setProperty('--desktop-ui-scale', String(scale));
  document.documentElement.dataset.desktopRuntime = 'electrobun';

  const root = document.getElementById('app');
  if (!root) {
    return;
  }

  root.style.setProperty('--desktop-ui-scale-inverse', String(1 / scale));
  root.dataset.desktopScaled = 'true';
};

applyDesktopUiScale();

const root = document.getElementById('app');

if (root) {
  render(() => <App />, root);
}
