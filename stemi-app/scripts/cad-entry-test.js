/* The CAD number entered manually by the EMT, the unsent case, and working without a connection. Since 0.6.0 the case
   is created on the platform and linked to the unit's corpuls monitor as soon as the CAD number is confirmed (LINK
   CORPULS), so monitor data has a case to attach to:
   - CAD#…, cad # …, plain, extra spaces and 13 digits are normalised; an invalid number is explained and refused
   - the case exists from LINK CORPULS but reaches no ER screen before SEND; a correction before SEND moves the case,
     with what corpuls sent, to the corrected number (audited)
   - a number that already has a case: CASE ALREADY EXISTS → correct the number (audited) or OPEN EXISTING CASE
   - the unsent case survives a page reload, and can be discarded (its corpuls feed ends); after SEND the CAD is locked
   - offline: the CAD number is kept and the case is created when the connection returns (CASE ALREADY EXISTS then if
     the number is taken); SEND waits (NOT SENT — NO CONNECTION) and goes on reconnection; an update saved offline is
     delivered once, with both times in the audit
   Run: npm run test:cad   (cloud container: NODE_PATH=$(npm root -g) npm run test:cad). Fictional data only. */
const H = require('./lib/harness');
const { chromium } = H.playwright();
const R = H.Results('CAD entry and offline');
const ok = R.ok, sleep = H.sleep;

async function main(S) {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const { ctx, page: C } = await H.crewPage(browser, S.BASE, errors);
    const con = H.Api(S.BASE, 'control'); await con.start();
    const er = H.Api(S.BASE, 'er'); await er.start();
    const EXISTING = H.cad(777), CORRECTED = H.cad(778), OFFL = H.cad(779);
    const row = c => H.db(S.DATA, `SELECT * FROM cases WHERE cad='${c}'`)[0];
    const waitText = (s, t) => C.waitForFunction(x => document.body.innerText.includes(x), s, { timeout: t || 15000 }).then(() => true, () => false);
    /* the network is cut: wait until the screen says so (CONNECTION LOST or OFFLINE — CHANGES SAVED LOCALLY) */
    const goOffline = async () => { await ctx.setOffline(true); await C.waitForSelector('.conn--down, .conn--offline', { timeout: 20000 }).catch(() => {}); };
    const goOnline = async () => { await ctx.setOffline(false); await C.waitForSelector('.conn:not(.conn--down):not(.conn--offline):not(.conn--wait)', { timeout: 20000 }); };
    const startNew = async () => { await C.click('[data-act="home"]').catch(() => {}); await C.click('[data-act="new-case"]'); await C.waitForSelector('#cadin'); };
    const head = () => C.textContent('.draft-h');

    /* ---------- normalisation and validation ---------- */
    await startNew();
    for (const [typed, why] of [['2026', 'incomplete'], ['20261399-0001-1', 'impossible date'], ['', 'empty']]) {
      await C.fill('#cadin', typed); await C.click('[data-act="cad-ok"]'); await sleep(150);
      ok('CAD', `Invalid CAD number (${why}) refused with an explanation`, await C.isVisible('#cad-err') && /Enter a valid CAD number before continuing/.test(await C.textContent('#cad-err')) && (await C.getAttribute('#cadin', 'aria-invalid')) === 'true');
    }
    await C.fill('#cadin', `  CAD# ${H.cad(770)}  `); await C.click('[data-act="cad-ok"]');
    await C.waitForSelector('#d-bar .cbar');
    ok('CAD', '"  CAD# …  " accepted and shown as CAD #… (canonical)', (await head()).includes(`CAD #${H.cad(770)}`));
    ok('CAD', 'LINK CORPULS: the case exists on the platform as an unsent case, linked to the unit\'s corpuls monitor', !!row(H.cad(770)) && !row(H.cad(770)).server_received_at && row(H.cad(770)).corpuls_device_id === 'SIM-C3-214');
    ok('CAD', 'The ER cannot see an unsent case', !(await er.view(H.cad(770))));
    await C.click('[data-act="cad-edit"]');
    await C.fill('#cadin', 'cad # ' + H.cad(771).replace(/-/g, ' - ')); await C.click('[data-act="cad-ok"]');
    await C.waitForFunction(c => document.querySelector('.draft-h') && document.querySelector('.draft-h').innerText.includes(c), `CAD #${H.cad(771)}`, { timeout: 8000 }).catch(() => {});
    ok('CAD', '"cad # 2026… - 0771 - 1" (lower case, extra spaces) normalised; the case moved to the corrected number', (await head()).includes(`CAD #${H.cad(771)}`) && !row(H.cad(770)) && !!row(H.cad(771)));
    await C.click('[data-act="cad-edit"]');
    await C.fill('#cadin', H.cad(772).replace(/-/g, '')); await C.click('[data-act="cad-ok"]');
    await C.waitForFunction(c => document.querySelector('.draft-h') && document.querySelector('.draft-h').innerText.includes(c), `CAD #${H.cad(772)}`, { timeout: 8000 }).catch(() => {});
    ok('CAD', '13 digits without dashes normalised', (await head()).includes(`CAD #${H.cad(772)}`));
    const audC = H.auditOf(S.DATA, H.cad(772)).map(a => a.action);
    ok('CAD', 'Audit: each correction before SEND, under the final number', audC.some(a => a.startsWith(`CAD number corrected by crew before sending: CAD #${H.cad(770)} → CAD #${H.cad(771)}`)) && audC.some(a => a.startsWith(`CAD number corrected by crew before sending: CAD #${H.cad(771)} → CAD #${H.cad(772)}`)));
    await C.waitForSelector('.cbar--ok', { timeout: 10000 });
    ok('CAD', 'The corpuls feed moved with the case: ECG 1 acquired now attaches to the corrected number', (await H.sim(S.BASE, H.cad(772), 'trigger-ecg', { sample: 'A' })).body.n === 1 && await C.waitForSelector('#d-viewer:not([hidden]) img', { timeout: 8000 }).then(() => true, () => false));

    /* ---------- the unsent case survives a reload ---------- */
    await C.fill('#md-age', '67'); await C.click('[data-act="md-nv"][data-k="sex"][data-v="Unknown"]');
    await sleep(500);
    await C.reload(); await C.waitForSelector('[data-act="new-case"]');
    const card = await C.waitForSelector('.draftcard', { timeout: 5000 }).then(() => true, () => false);
    ok('DRAFT', 'After a reload the unsent case is kept on the tablet (home shows it, not sent)', card && (await C.textContent('.draftcard')).includes(`CAD #${H.cad(772)}`) && (await C.textContent('.draftcard')).includes('ECG 1 from corpuls'));
    await C.click('[data-act="draft-open"]');
    await C.waitForSelector('#md-age');
    ok('DRAFT', 'Continue: the ECG from corpuls and the answers are all there', (await C.inputValue('#md-age')) === '67' && (await C.getAttribute('[data-act="md-nv"][data-k="sex"][data-v="Unknown"]', 'aria-pressed')) === 'true' && await C.isVisible('#d-viewer img'));
    await C.click('[data-act="draft-discard"]'); await C.click('[data-act="draft-discard-go"]');
    ok('DRAFT', 'An unsent case can be discarded, with confirmation', await waitText('Unsent case discarded') && !(await C.isVisible('.draftcard')));
    await sleep(800);
    const disc = row(H.cad(772));
    ok('DRAFT', 'Discarded: never sent, kept on the platform, its corpuls feed ended (audited)', disc && !disc.server_received_at && disc.draft_discarded_at > 0 && disc.corpuls_link_ended_at > 0 && H.auditOf(S.DATA, H.cad(772)).some(a => a.action.startsWith('Unsent case discarded')));

    /* ---------- CASE ALREADY EXISTS at LINK CORPULS ---------- */
    ok('DUP', 'A case exists under the number (sent from the test console)', (await con.req('POST', '/api/control/demo-case', { cad: EXISTING })).status === 200);
    await startNew();
    await C.fill('#cadin', EXISTING); await C.click('[data-act="cad-ok"]');
    const dup = await C.waitForSelector('.modal >> text=CASE ALREADY EXISTS', { timeout: 10000 }).then(() => true, () => false);
    ok('DUP', 'LINK CORPULS under an existing number: CASE ALREADY EXISTS, nothing created or changed', dup && (await C.textContent('.modal')).includes(`CAD #${EXISTING}`) && H.db(S.DATA, `SELECT COUNT(*) n FROM cases WHERE cad='${EXISTING}'`)[0].n === 1);
    await H.shot(C, 'cad-01-case-exists');
    await C.click('[data-act="dup-fix"]');
    await C.waitForSelector('#cadin');
    await C.fill('#cadin', CORRECTED); await C.click('[data-act="cad-ok"]');
    await C.waitForSelector('.cbar--ok', { timeout: 10000 });
    await H.sim(S.BASE, CORRECTED, 'trigger-ecg', { sample: 'A' });
    await C.waitForSelector('#d-viewer:not([hidden]) img', { timeout: 8000 });
    await C.fill('#md-age', '61'); await C.click('[data-act="md-set"][data-k="sex"][data-v="Female"]'); await C.click('[data-act="md-set"][data-k="complaint"][data-v="sob"]');
    await C.click('[data-act="md-nv"][data-k="onset"][data-v="Unknown"]');
    await C.click('[data-act="send"]');
    await C.waitForSelector(`.case-h__cad:has-text("CAD #${CORRECTED}")`, { timeout: 20000 });
    ok('DUP', 'Sent under the corrected number: SENT TO ER', (await C.textContent('.status-panel')).includes('SENT TO ER') && row(CORRECTED).server_received_at > 0);
    ok('DUP', 'The existing case was not changed', row(EXISTING).unit === 'Ambulance 214' && H.auditOf(S.DATA, EXISTING).every(a => !a.action.includes(CORRECTED)));
    const aud = H.auditOf(S.DATA, CORRECTED).map(a => a.action);
    ok('DUP', 'Audit: the correction before sending, and the manual CAD entry', aud.some(a => a.includes(`CAD number corrected by crew before sending: CAD #${EXISTING} → CAD #${CORRECTED}`)) && aud.some(a => a.includes('CAD number manually entered by crew from dispatch/MDT information')));
    ok('LOCK', 'After SEND the CAD number is locked: no CAD field and no Change on the case', !(await C.$('#cadin')) && !(await C.$('[data-act="cad-edit"]')));

    /* ---------- offline at CAD entry; the number turns out to exist → OPEN EXISTING CASE ---------- */
    await startNew();
    await goOffline();
    await C.fill('#cadin', EXISTING); await C.click('[data-act="cad-ok"]');
    await C.waitForSelector('#d-bar .cbar', { timeout: 5000 });
    ok('OFF', 'Offline at CAD entry: the number is kept and the workflow continues, corpuls linked later', /NO CONNECTION — CORPULS NOT LINKED YET/.test(await C.textContent('#d-bar')) && /Offline — changes saved locally/i.test(await C.textContent('#tb-conn')));
    ok('OFF', 'Offline: the manual ECG fallback is offered prominently', await C.isVisible('#d-bar [data-act="fb-draft"]'));
    await goOnline();
    const dup2 = await C.waitForSelector('.modal >> text=CASE ALREADY EXISTS', { timeout: 15000 }).then(() => true, () => false);
    ok('DUP', 'On reconnection the number is checked: CASE ALREADY EXISTS', dup2);
    await C.click('[data-act="dup-open"]');
    ok('DUP', 'OPEN EXISTING CASE opens that case; no second case', await C.waitForSelector(`.case-h__cad:has-text("CAD #${EXISTING}")`, { timeout: 8000 }).then(() => true, () => false) && H.db(S.DATA, `SELECT COUNT(*) n FROM cases WHERE cad='${EXISTING}'`)[0].n === 1);
    ok('DUP', 'Audit: the existing case was opened on the tablet', H.auditOf(S.DATA, EXISTING).some(a => a.action.startsWith(`Existing case CAD #${EXISTING} opened on the Ambulance 214 tablet`)));
    await C.click('[data-act="home"]');
    if (await C.isVisible('.draftcard')) { await C.click('.draftcard [data-act="draft-discard"]'); await C.click('[data-act="draft-discard-go"]'); }

    /* ---------- offline SEND: waits on the tablet, goes on reconnection ---------- */
    await H.crewNewCase(C, OFFL, { noSend: true });
    await goOffline();
    await C.click('[data-act="send"]');
    const q = await C.waitForSelector('.sendbar >> text=NOT SENT', { timeout: 8000 }).then(() => true, () => false);
    ok('OFF', 'SEND without a connection: NOT SENT — NO CONNECTION, saved on the tablet', q && /sent automatically when the connection returns/.test(await C.textContent('.sendbar')) && !row(OFFL).server_received_at);
    await H.shot(C, 'cad-02-offline-send');
    await ctx.setOffline(false);
    const sent = await C.waitForSelector(`.case-h__cad:has-text("CAD #${OFFL}")`, { timeout: 25000 }).then(() => true, () => false);
    ok('OFF', 'On reconnection the case is sent automatically (marked delivered after a failed attempt)', sent && row(OFFL).server_received_at > 0 && row(OFFL).delivered_late === 1);

    /* ---------- offline update after SEND ---------- */
    await goOffline();
    await C.click('[data-act="treat"]'); await C.click('[data-act="t-k"][data-v="asp"]'); await C.click('[data-act="t-o"][data-v="Given"]');
    await C.click('[data-act="treat-save"]');
    ok('OFF', 'Offline: the treatment update waits, shown as OFFLINE — CHANGES SAVED LOCALLY', /Offline — changes saved locally/i.test(await C.textContent('#tb-conn')) && /waiting to send/.test(await C.textContent('#c-pt')));
    await sleep(6000);
    await ctx.setOffline(false);
    let delivered = false;
    for (let i = 0; i < 40 && !delivered; i++) { await sleep(500); delivered = H.db(S.DATA, `SELECT COUNT(*) n FROM treatments WHERE cad='${OFFL}' AND item_key='asp'`)[0].n === 1; }
    ok('OFF', 'On reconnection the update is delivered once, with both times kept in the audit', delivered && H.auditOf(S.DATA, OFFL).some(a => /Treatment update by crew — Aspirin: Given.*saved on the tablet/.test(a.action)));
    ok('', 'No script errors', !errors.length, errors.slice(0, 3).join(' | '));
  } finally { await browser.close(); }
}

(async () => {
  const S = await H.startServer({ MOCK_AI_DELAY_MS: '800' });
  try { await main(S); } catch (e) { console.error(e); R.ok('', 'The test ran to the end', false, e.message); } finally { await S.stop(); }
  process.exit(R.summary() ? 1 : 0);
})();
