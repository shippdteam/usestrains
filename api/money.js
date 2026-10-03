// Scheduled at half past every hour: collect creator fees, split them, pay owners, buy and burn $STRAINS.
const { money } = require('../engine/money');
exports.handler = async () => { try { console.log((await money()).join(' | ')); } catch (e) { console.error(e); } return { statusCode: 200 }; };
