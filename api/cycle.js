// Scheduled on the hour: trading, the judge, scores, one death, one birth.
const { cycle } = require('../engine/cycle');
exports.handler = async () => { try { console.log((await cycle()).join(' | ')); } catch (e) { console.error(e); } return { statusCode: 200 }; };
