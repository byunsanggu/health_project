import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NICKNAME_MAX, NICKNAME_MIN,
  checkNickname, cleanNickname, nicknameKey, suggestNicknames,
} from '../nickname.ts';

describe('닉네임 받아 적기', () => {
  it('공백은 거절하지 않고 밑줄로 바꾼다', () => {
    /*
     * "공백은 안 됩니다"로 돌려보내는 것보다 바꿔 놓고 보여주는 쪽이
     * 빠르다. 사용자가 할 일은 맞는지 보는 것뿐이다.
     */
    assert.equal(cleanNickname('  철수   형 '), '철수_형');
  });

  it('길이를 넘기면 잘라서 보여준다', () => {
    assert.equal(cleanNickname('가'.repeat(30)).length, NICKNAME_MAX);
  });

  it('밑줄과 대소문자는 같은 이름으로 센다', () => {
    // "볼륨_코치"로 "볼륨코치"를 사칭하는 길을 막으려면 둘이 같아야 한다.
    assert.equal(nicknameKey('볼륨_코치'), nicknameKey('볼륨코치'));
    assert.equal(nicknameKey('Mike_99'), nicknameKey('mike99'));
  });
});

describe('닉네임 규칙', () => {
  const ok = (raw: string) => checkNickname(raw).ok;
  const why = (raw: string) => checkNickname(raw).problem;

  it('평범한 이름은 통과한다', () => {
    assert.ok(ok('철수'));
    assert.ok(ok('Mike_99'));
    assert.ok(ok('새벽리프터'));
  });

  it('너무 짧거나 길면 막는다', () => {
    assert.equal(why(''), 'empty');
    assert.equal(why('가'), 'tooShort');
    assert.equal(why('가'.repeat(NICKNAME_MAX + 1)), 'tooLong');
    assert.ok(ok('가'.repeat(NICKNAME_MAX)));
    assert.ok(ok('가'.repeat(NICKNAME_MIN)));
  });

  it('낱자는 글자가 아니다', () => {
    assert.equal(why('ㅋㅋㅋ'), 'jamo');
    assert.equal(why('철ㅅ수'), 'jamo');
  });

  it('특수문자와 이모지는 받지 않는다', () => {
    assert.equal(why('철수@짐'), 'badChar');
    assert.equal(why('철수💪'), 'badChar');
  });

  it('밑줄은 가운데에 하나씩만', () => {
    assert.equal(why('_철수'), 'underscoreEdge');
    assert.equal(why('철수_'), 'underscoreEdge');
    assert.equal(why('철수__형'), 'underscoreEdge');
    assert.ok(ok('철수_형'));
  });

  it('전화번호는 닉네임 자리에 들어오지 못한다', () => {
    /*
     * 닉네임은 낯선 사람에게 그대로 보인다. 여기로 번호가 새면
     * 개인정보가 새는 것이다.
     */
    assert.equal(why('01012345678'), 'phoneLike');
    assert.equal(why('a01099998888'), 'phoneLike');
  });

  it('숫자만으로는 안 된다', () => {
    assert.equal(why('123456'), 'digitsOnly');
    assert.ok(ok('3대500'));
  });

  it('운영자 사칭은 포함만 해도 막는다', () => {
    assert.equal(why('관리자'), 'reserved');
    assert.equal(why('운영자_김'), 'reserved');
    assert.equal(why('볼륨코치'), 'reserved');
    assert.equal(why('볼륨_코치'), 'reserved');
    assert.equal(why('Admin'), 'reserved');
    assert.equal(why('xx_support'), 'reserved');
  });

  it('막을 때는 무엇을 고치면 되는지까지 말한다', () => {
    for (const raw of ['', '가', 'ㅋㅋㅋ', '철수@짐', '_철수', '01012345678', '123456', '관리자']) {
      const result = checkNickname(raw);
      assert.equal(result.ok, false);
      assert.ok(result.message.length > 0, raw);
      assert.ok(result.message.endsWith('.'), raw);
    }
  });
});

describe('닉네임 지어 주기', () => {
  it('같은 씨앗이면 같은 목록 — 새로고침할 때마다 바뀌지 않는다', () => {
    assert.deepEqual(suggestNicknames(42), suggestNicknames(42));
  });

  it('지어 준 이름은 제 규칙을 통과한다', () => {
    for (let seed = 0; seed < 300; seed += 7) {
      for (const name of suggestNicknames(seed, 4)) {
        const result = checkNickname(name);
        assert.ok(result.ok, `${name}: ${result.message}`);
      }
    }
  });

  it('씨앗이 다르면 대체로 다른 이름이 나온다', () => {
    const a = suggestNicknames(1).join();
    const b = suggestNicknames(2).join();
    assert.notEqual(a, b);
  });

  it('몸이나 외모를 가리키는 말은 넣지 않는다', () => {
    /*
     * 닉네임을 받는 자리에서 "날씬한"을 먼저 보여주면 그게 이 앱이
     * 무엇을 중요하게 보는지에 대한 선언이 된다.
     */
    const banned = ['날씬', '뚱', '살', '근육질', '몸매', '다이어트'];
    for (let seed = 0; seed < 200; seed += 3) {
      for (const name of suggestNicknames(seed, 4)) {
        for (const word of banned) assert.ok(!name.includes(word), name);
      }
    }
  });
});
