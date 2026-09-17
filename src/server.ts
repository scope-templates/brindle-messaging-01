/**
 * Starting Brindle: open the store, build the app, start the carrier that moves accepted messages
 * along and the dispatcher that posts webhook deliveries, and listen. On the way down the store is
 * written out so nothing accepted in the last quarter of a second is lost.
 */
import { createApp, API_VERSION } from './app.js';
import { Dispatcher } from './dispatch.js';
import { openStore, storeFile } from './store.js';

function main(): void {
  const store = openStore();
  const { app, carrier } = createApp(store);
  const dispatcher = new Dispatcher(store);
  carrier.start();
  dispatcher.start();

  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => {
    const counts = store.counts();
    console.log(`Brindle ${API_VERSION} is listening on ${port}`);
    console.log(`  store   ${storeFile()}`);
    console.log(`  holding ${counts.accounts} accounts, ${counts.messages} messages`);
  });

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: finishing off`);
    carrier.stop();
    dispatcher.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main();
