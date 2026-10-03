// Every setting in one place. Each one is an environment variable, so nothing needs a code change.
const num = (k, d) => (process.env[k] != null && process.env[k] !== '' ? +process.env[k] : d);
const cfg = () => ({
  strainPrice: num('STRAIN_PRICE_SOL', 1),        // a wallet's 2nd, 3rd… strain costs this; it all goes to the burn wallet
  minFuel: num('MIN_FUEL_SOL', 0.1),              // smallest first deposit when creating a strain
  launchCost: num('LAUNCH_COST_SOL', 0.025),      // taken from fuel per coin: pump.fun rent, network fees, PumpPortal, AI
  intervals: [1, 5, 15, 60, 240, 1440],            // quick picks shown on the site; any whole number of minutes is allowed
  minInterval: num('MIN_INTERVAL_MIN', 1), maxInterval: num('MAX_INTERVAL_MIN', 10080),
  devBuys: [0, 0.01, 0.05, 0.1],                  // quick picks; any amount from 0 up to maxDevBuy is allowed
  maxDevBuy: num('MAX_DEV_BUY_SOL', 10),
  graceHours: num('GRACE_HOURS', 2),              // a new strain can't die in its first hours
  minPopulation: num('MIN_POPULATION', 4),        // nobody dies while this few or fewer are alive
  maxPopulation: num('MAX_POPULATION', 300),      // no breeding above this
  cullPerHour: num('CULL_PER_HOUR', 1),
  breedPerHour: num('BREED_PER_HOUR', 1),
  marketWeight: num('MARKET_WEIGHT', 60),         // % of the score from trading; the rest from the AI judge
  payoutMin: num('PAYOUT_MIN_SOL', 0.01),         // fees are paid out hourly once a wallet is owed this much
  burnMin: num('BURN_MIN_SOL', 0.05),
  aiImages: process.env.AI_IMAGES !== 'false',
  priorityFee: num('PRIORITY_FEE', 0.0003),
  mint: process.env.STRAINS_MINT || '',
  xUrl: process.env.X_URL || 'https://x.com/usestrains',
});
const VIBES = ['Animals', 'Internet culture', 'AI & tech', 'Food', 'Space', 'Absurd', 'Retro games', 'Sports', 'Music', 'Nature', 'Money jokes', 'Cute'];
module.exports = { cfg, VIBES };
