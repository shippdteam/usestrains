// Scheduled every minute: launches coins for strains whose time has come.
const { tick } = require('../engine/launcher');
exports.handler = async () => { try { const log = await tick(); if (log.length) console.log(log.join(' | ')); } catch (e) { console.error(e); } return { statusCode: 200 }; };
