import sqlocal from 'sqlocal/vite';
import type { UserConfig } from 'vite';

const config: UserConfig = {
  plugins: [sqlocal()],
};

export default config;
