/**
 * Catch-up for webhook deliveries. The running API posts these itself, on a timer; this is for a
 * store nothing is serving — after a restore, or against a `DATA_DIR` a server is not up on.
 * It walks whatever is due and attempts it. `--dry` prints what it would try and sends nothing.
 */
import { attemptDelivery, isDue } from '../src/webhooks.js';
import { openStore } from '../src/store.js';
import type { Store } from '../src/store.js';

async function run(store: Store, dry: boolean): Promise<void> {
  const now = Date.now();
  const waiting = store.pendingDeliveries().filter((delivery) => isDue(delivery, now));

  if (waiting.length === 0) {
    console.log('Nothing is waiting.');
    return;
  }
  console.log(`${waiting.length} deliveries are due.`);

  let landed = 0;
  let missed = 0;

  for (const delivery of waiting) {
    const hook = store.webhook(delivery.webhook_id);
    if (!hook || !hook.active) continue;

    if (dry) {
      console.log(`  would try ${delivery.id} at ${hook.url} (attempt ${delivery.attempts + 1})`);
      continue;
    }

    await attemptDelivery(store, delivery, hook);
    if (delivery.status === 'succeeded') {
      landed += 1;
    } else {
      missed += 1;
      console.log(`  ${hook.url}: ${delivery.last_error ?? 'no answer'} (attempt ${delivery.attempts})`);
    }
  }

  if (!dry) console.log(`${landed} landed, ${missed} did not.`);
}

function main(): void {
  const dry = process.argv.slice(2).includes('--dry');
  const store = openStore();

  run(store, dry)
    .then(() => {
      store.close();
    })
    .catch((error: unknown) => {
      console.error(error);
      store.close();
      process.exit(1);
    });
}

main();
