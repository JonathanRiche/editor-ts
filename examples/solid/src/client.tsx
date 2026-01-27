import { hydrate } from 'solid-js/web';
import App from './App';
import './styles.css';

const root = document.getElementById('app');
if (root) {
  hydrate(() => <App />, root);
}
