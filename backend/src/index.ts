import { createApp } from './app';
import { env } from './shared/env';

const app = createApp();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`AI Memory backend listening on port ${env.port}`);
});
