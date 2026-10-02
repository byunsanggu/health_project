import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CHEERS, CODE_ALPHABET, CODE_LENGTH,
  buildQuest, canCheer, cheerText, formatFriendCode,
  friendRow, groupQuest as buildGroup, normalizeFriendCode,
} from '../friends.ts';

describe('친구 코드', () => {
  it('헷갈리는 글자를 안 쓴다', () => {
    /*
     * 카톡으로 코드를 받아 적다 0과 O를 헷갈리면 그 사람은 다시 시도하지
     * 않는다. 0·O·1·I·L을 아예 뺀다.
     */
    for (const bad of ['0', 'O', '1', 'I', 'L']) {
      assert.ok(!CODE_ALPHABET.includes(bad), `${bad}가 코드에 들어 있습니다`);
    }
  });

  it('사람이 적어 온 꼴을 받아 준다', () => {
    assert.equal(normalizeFriendCode('a2b3c4'), 'A2B3C4');
    assert.equal(normalizeFriendCode('A2B-3C4'), 'A2B3C4');
    assert.equal(normalizeFriendCode(' A2B 3C4 '), 'A2B3C4');
  });

  it('틀린 코드는 거절한다', () => {
    assert.equal(normalizeFriendCode('A2B3C'), null, '짧은 것');
    assert.equal(normalizeFriendCode('A2B3C44'), null, '긴 것');
    assert.equal(normalizeFriendCode('A2B3C0'), null, '없는 글자(0)');
    assert.equal(normalizeFriendCode(''), null);
  });

  it('보여줄 때는 가운데를 띄운다', () => {
    assert.equal(formatFriendCode('A2B3C4'), 'A2B-3C4');
    assert.equal(formatFriendCode('a2b3c4'), 'A2B-3C4');
  });

  it('길이가 여섯이다', () => {
    assert.equal(CODE_LENGTH, 6);
    assert.equal(normalizeFriendCode('A'.repeat(CODE_LENGTH))?.length, CODE_LENGTH);
  });
});

describe('응원', () => {
  it('정해진 문구만 있다 — 자유 입력이 없다', () => {
    /*
     * 쪽지가 열리는 순간 괴롭힘·스팸·유출 경로가 같이 열린다. 보낼 수
     * 있는 말이 표에 있는 것 전부여야 그 문이 아예 없다.
     */
    assert.ok(CHEERS.length > 0 && CHEERS.length <= 5);
    for (const cheer of CHEERS) {
      assert.equal(cheerText(cheer.kind), cheer.text);
      assert.ok(cheer.text.length > 0);
    }
    assert.equal(cheerText('nope' as never), '');
  });

  it('재촉하는 말이 없다', () => {
    // "왜 안 나와"는 친구가 할 말이지 앱이 만들어 줄 말이 아니다.
    for (const cheer of CHEERS) {
      for (const bad of ['왜', '안 나', '빠지', '게으']) {
        assert.ok(!cheer.text.includes(bad), `재촉: ${cheer.text}`);
      }
    }
  });

  it('하루에 친구당 한 번', () => {
    assert.equal(canCheer(undefined, '2026-09-30'), true);
    assert.equal(canCheer('2026-09-29T23:59:00.000Z', '2026-09-30'), true);
    assert.equal(canCheer('2026-09-30T00:01:00.000Z', '2026-09-30'), false);
  });
});

describe('친구 한 줄', () => {
  const base = { userId: 'u2', name: '영수', days: 2, target: 4, streakWeeks: 3 };

  it('다 채웠으면 그렇게 말한다', () => {
    const row = friendRow({ ...base, days: 4 }, '2026-09-30');
    assert.equal(row.kept, true);
    assert.match(row.text, /4번 다 채웠습니다/);
  });

  it('한 번 남으면 알려준다', () => {
    const row = friendRow({ ...base, days: 3 }, '2026-09-30');
    assert.match(row.text, /3 \/ 4 · 한 번 남았습니다/);
  });

  it('안 나온 사람을 타박하지 않는다', () => {
    /*
     * 0/4는 숫자로 보이면 된다. "아직 한 번도 안 나왔습니다"라고 쓰면
     * 그건 앱이 대신 하는 잔소리다.
     */
    const row = friendRow({ ...base, days: 0 }, '2026-09-30');
    assert.equal(row.text, '0 / 4');
    for (const bad of ['아직', '한 번도', '안 나']) {
      assert.ok(!row.text.includes(bad), row.text);
    }
  });

  it('보이는 것에 무게·종목·통증이 없다', () => {
    /*
     * FriendWeek에 담을 수 있는 것이 곧 친구에게 보이는 것 전부다.
     * 여기에 필드가 하나 늘면 그 순간 건강 정보가 새기 시작한다.
     */
    const row = friendRow(base, '2026-09-30');
    assert.deepEqual(
      Object.keys(row).sort(),
      ['canCheer', 'days', 'kept', 'lastCheerAt', 'name', 'streakWeeks', 'target', 'text', 'userId']
        .filter((key) => key !== 'lastCheerAt').sort());
  });
});

describe('같이 하는 챌린지', () => {
  it('목표는 각자 하기로 한 횟수의 합이다', () => {
    /*
     * 이게 전부다. 앱이 "이번 주 10번!"을 정해 주면 주 3회 하기로 한
     * 사람이 친구 때문에 5번 나온다. 그건 챌린지가 아니라 부상이다.
     */
    const quest = buildQuest({
      mine: { days: 1, target: 4 },
      theirs: { days: 2, target: 3 },
      friendName: '영수',
    });
    assert.equal(quest.target, 7);
    assert.equal(quest.done, 3);
    assert.equal(quest.left, 4);
    assert.equal(quest.kept, false);
  });

  it('아무도 자기 목표보다 더 하게 되지 않는다', () => {
    // 둘 다 자기 약속만 지키면 챌린지는 저절로 채워진다.
    for (const [a, b] of [[2, 2], [3, 4], [5, 1], [4, 4]]) {
      const quest = buildQuest({
        mine: { days: a!, target: a! },
        theirs: { days: b!, target: b! },
        friendName: '영수',
      });
      assert.equal(quest.kept, true, `${a}+${b}`);
    }
  });

  it('다 채우면 이름을 넣어 말한다 — 조사가 받침을 따라간다', () => {
    const withFinal = buildQuest({
      mine: { days: 4, target: 4 }, theirs: { days: 3, target: 3 }, friendName: '영수',
    });
    assert.match(withFinal.text, /영수와/);
    const withoutFinal = buildQuest({
      mine: { days: 4, target: 4 }, theirs: { days: 3, target: 3 }, friendName: '민지',
    });
    assert.match(withoutFinal.text, /민지와/);
    const consonant = buildQuest({
      mine: { days: 4, target: 4 }, theirs: { days: 3, target: 3 }, friendName: '짐맨',
    });
    assert.match(consonant.text, /짐맨과/);
  });

  it('한 번 남았을 때 같이 하자고 한다', () => {
    const quest = buildQuest({
      mine: { days: 3, target: 4 }, theirs: { days: 3, target: 3 }, friendName: '영수',
    });
    assert.equal(quest.left, 1);
    assert.match(quest.text, /한 번만 더/);
  });

  it('목표가 0이 되지 않는다', () => {
    const quest = buildQuest({
      mine: { days: 0, target: 0 }, theirs: { days: 0, target: 0 }, friendName: '영수',
    });
    assert.ok(quest.target >= 1);
  });
});

describe('친구가 여럿일 때', () => {
  const friend = (name: string, days: number, target: number) =>
    ({ userId: name, name, days, target, streakWeeks: 0 });

  it('다 합쳐 하나로 센다', () => {
    const quest = buildGroup({ days: 2, target: 4 }, [
      friend('영수', 3, 3), friend('민지', 1, 2),
    ]);
    assert.equal(quest?.target, 9);
    assert.equal(quest?.done, 6);
  });

  it('친구가 없으면 챌린지도 없다', () => {
    assert.equal(buildGroup({ days: 2, target: 4 }, []), null);
  });

  it('한 명이면 그 사람 이름을 쓴다', () => {
    const quest = buildGroup({ days: 4, target: 4 }, [friend('영수', 3, 3)]);
    assert.match(quest!.text, /영수와/);
  });

  it('여럿이면 사람 수로 부른다', () => {
    const quest = buildGroup({ days: 4, target: 4 }, [friend('영수', 3, 3), friend('민지', 2, 2)]);
    assert.match(quest!.text, /친구 2명과/);
  });

  it('각자 자기 약속만 지켜도 다 채워진다', () => {
    const quest = buildGroup({ days: 4, target: 4 }, [friend('영수', 3, 3), friend('민지', 2, 2)]);
    assert.equal(quest!.kept, true);
  });
});
