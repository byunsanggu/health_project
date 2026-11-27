// 아이폰 잠금 화면의 휴식 끝 — PT도. 알림으로 받기로 했으면 화면이 꺼질 때 PT 소리 파일(<audio>)을 틀지 않고
//   (음악이 멈춘다) 휴식 끝 알림을 건다. 알림 문장은 PT 화면의 다음 세트 한 줄을 따르고, 폰 안에만 적힌다.
//   돌아오면 알림을 지우고 PT는 멈추지 않고 잇는다.
import { check, choosePt, focusPhase, onboard, begin, runUntil, setVisible, skipPrep, skipWarm } from './lib.mjs';
import { fakeAudioAndCaches, fakeIphoneServer, probes } from './restpush.e2e.mjs';

export default async function ({ page, url, shot }) {
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await fakeAudioAndCaches(page);
  await page.goto(url);
  await onboard(page);
  await choosePt(page);
  await fakeIphoneServer(page);
  const { calls, loud, record, settle } = probes(page);
  await page.evaluate(() => {
    window.__tracks = 0;
    window.RestSound.playTrack = () => { window.__tracks += 1; };
  });

  await begin(page);
  await runUntil(page, 'prep');
  await skipPrep(page);
  if (await runUntil(page, ['warm', 'count']) === 'warm') {
    await skipWarm(page);
    await runUntil(page, 'count');
  }
  await runUntil(page, 'rest', { maxMs: 180000 });
  // 소리 파일을 만들 시간 — 만들어 두었어도 알림 모드에서는 틀지 않아야 한다
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(150);
    await page.clock.runFor(100);
  }

  const loudBefore = await loud();
  await setVisible(page, false);
  await settle();
  check(await page.evaluate(() => window.__tracks) === 0, '알림 모드인데 PT 소리 파일을 틀었습니다 — 음악이 멈춥니다');
  check(await loud() === loudBefore, '알림 모드인데 <audio>를 틀었습니다');
  const armed = await calls('/functions/v1/rest-alarm');
  check(armed.length === 1, 'PT 휴식 중에 화면이 꺼졌는데 알림을 걸지 않았습니다');
  check(!/[가-힣]/.test(armed[0].body), '서버로 가는 요청에 한글(종목 이름)이 있습니다: ' + armed[0].body);
  const saved = await record();
  check(saved && /^휴식 끝 · /.test(saved.title), 'PT 알림 제목: ' + JSON.stringify(saved));
  check(/세트 · .+ × /.test(saved.body) && saved.body.includes('PT가 이어서'), 'PT 알림 본문이 다음 세트 한 줄을 따르지 않습니다: ' + saved.body);

  await page.clock.runFor(20000);
  await setVisible(page, true);
  await settle();
  const cancels = await calls('/rest/v1/rpc/cancel_rest_alarm');
  check(cancels.length === 1 && JSON.parse(cancels[0].body).alarm === JSON.parse(armed[0].body).alarm_id, '돌아왔는데 PT 휴식 알림을 지우지 않았습니다');
  await page.clock.runFor(500);
  check(await focusPhase(page) !== 'paused', '돌아왔는데 PT가 멈춰 있습니다');
  await shot('1-back');
}
