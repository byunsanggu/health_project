// 화면에 나가는 말 — 현장 용어(RIR · 1RM · 축적 · 디로드)와 2026-10-22 같은 날짜를 쓰지 않는다.
//   좁은 폰(320px)에서 편집 버튼 줄이 카드 밖으로 잘리지 않고, "원래대로"가 두 줄로 쪼개지지 않는다.
import { check, onboard, tab } from './lib.mjs';

const JARGON = /RIR|1RM|축적|디로드|템플릿|기준선/;
const ISO = /\d{4}-\d{2}-\d{2}/;

async function visibleText(page, selector) {
  return (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ');
}

export default async function ({ page, url, shot }) {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.clock.install({ time: new Date('2026-10-22T18:00:00+09:00') });
  await page.goto(url);
  await onboard(page);

  // 편집 — "종목 추가"(하나 더 끼운다), 버튼 줄은 카드 안에서 다음 줄로 넘어간다
  await page.locator('.list-edit').click();
  const chips = await page.locator('.head-actions .demo-open').allTextContents();
  check(chips.includes('종목 추가') && !chips.includes('다른 운동'), '편집 버튼: ' + chips.join(', '));
  const fits = await page.evaluate(() => {
    const sheet = document.querySelector('.head-actions').closest('.sheet').getBoundingClientRect();
    const close = document.querySelector('.list-edit').getBoundingClientRect();
    return {
      inside: [...document.querySelectorAll('.head-actions .demo-open')].every((chip) => chip.getBoundingClientRect().right <= sheet.right - 1),
      closeAtEdge: sheet.right - close.right < 20,
    };
  });
  check(fits.inside, '편집 버튼이 카드 밖으로 잘립니다');
  check(fits.closeAtEdge, '"닫기"가 카드 오른쪽 끝에 붙지 않습니다');
  await shot('1-edit-320');
  await page.locator('.list-edit').click();

  // 짧은 날 — "원래대로"는 한 줄
  await page.locator('button', { hasText: '운동 시간' }).first().click();
  await page.locator('.chip-row button', { hasText: /^20분$/ }).first().click();
  const reset = await page.locator('.short-note .pick').boundingBox();
  check(reset && reset.height < 40, '"원래대로"가 두 줄입니다: ' + JSON.stringify(reset));
  await page.locator('.short-note .pick').click();

  // 위 상태 줄 · 오늘 머리
  const head = (await page.locator('#status-meta, .status-meta').first().textContent()) + ' ' + await visibleText(page, '.session-head');
  check(!JARGON.test(head), '오늘 머리에 현장 용어: ' + head);

  // 두 세트 하고 마친 뒤 요약
  await page.click('.start-cta');
  await page.locator('.now-rir .chip', { hasText: '2회' }).click();
  await page.locator('#rest-host .rest-skip', { hasText: '건너뛰기' }).click();
  await page.locator('.now-rir .chip', { hasText: '2회' }).click();
  const doneLine = await visibleText(page, '#screen');
  check(!/RIR/.test(doneLine), '끝낸 세트 줄에 RIR: ' + (doneLine.match(/.{20}RIR.{10}/) || [''])[0]);
  await page.locator('button', { hasText: '운동 끝내기' }).first().click();
  await page.locator('dialog').getByRole('button', { name: '오늘 마치기' }).click();
  await page.getByRole('button', { name: '요약 다시 보기' }).click();
  const tag = (await page.locator('dialog .modal-head .pattern').textContent()).trim();
  check(tag === '10월 22일', '요약 날짜: ' + tag);
  const summary = await visibleText(page, 'dialog');
  check(!JARGON.test(summary), '요약에 현장 용어: ' + (summary.match(new RegExp('.{0,20}(' + JARGON.source + ').{0,20}')) || [''])[0]);
  await shot('2-summary');
  await page.locator('dialog .modal-close').click();

  // 주간 머리 · 블록 유형 · 정확도 카드
  await tab(page, '주간');
  const week = await visibleText(page, '#screen');
  check(!JARGON.test(week), '주간 탭에 현장 용어: ' + (week.match(new RegExp('.{0,20}(' + JARGON.source + ').{0,20}')) || [''])[0]);

  // 내 정보 — 동의한 날
  await page.click('#me-btn');
  const me = await visibleText(page, '#screen');
  check(!ISO.test(me), '내 정보에 2026-10-22 같은 날짜: ' + (me.match(/.{0,20}\d{4}-\d{2}-\d{2}.{0,20}/) || [''])[0]);
}
