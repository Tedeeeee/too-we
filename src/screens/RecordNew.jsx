import { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { palette, fonts } from '@/styles/tokens';
import { uiSvg, etcSvg } from '@assets/svg';
import Screen from '@/components/Screen';
import MaskIcon from '@/components/MaskIcon';
import BackButton from '@/components/BackButton';
import PrimaryButton from '@/components/PrimaryButton';
import FlowerRating from '@/components/FlowerRating';
import { useApp, useRecord } from '@/data/store';
import { formatRecordDate } from '@/data/format';

/**
 * 5초 기록 — 지도에서 고른 장소(placeId) 또는
 * 짝궁이 기다리는 기록(recordId)에 내 한 줄을 남긴다.
 */
export default function RecordNew() {
  const navigate = useNavigate();
  const location = useLocation();
  const { saveFiveSecondRecord } = useApp();

  const { recordId, placeId, placeName } = location.state || {};
  const pendingRecord = useRecord(recordId);

  const [text, setText] = useState('');
  const [rating, setRating] = useState(3);
  const [saving, setSaving] = useState(false);

  const now = useMemo(() => new Date().toISOString(), []);

  if (!recordId && !placeId) return <Navigate to="/" replace />;

  const title = pendingRecord?.placeName || placeName || '';
  const dateLabel = formatRecordDate(pendingRecord?.date || now);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const rec = await saveFiveSecondRecord({ recordId, placeId, text: text.trim(), rating, date: now });
    navigate('/pick', { state: { recordId: rec.id } });
  };

  return (
    <Screen>
      <BackButton left={16} top={82} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 88,
          width: 402,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: 28,
          color: palette.text,
        }}
      >
        5초 기록
      </div>
      <div style={{ position: 'absolute', left: 16, top: 149, fontFamily: fonts.hand, fontSize: 32, color: palette.textStrong }}>
        {title}
      </div>
      <div style={{ position: 'absolute', left: 16, top: 187, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>{dateLabel}</span>
        <MaskIcon src={etcSvg.pencil} color={palette.textMuted} size={16} />
      </div>
      {/* 사진 영역 — 업로드 전 자리 (프로토타입과 동일한 비주얼) */}
      <div style={{ position: 'absolute', left: 16, top: 226, width: 370, height: 230, borderRadius: 24, background: palette.beige }} />
      <button
        style={{
          position: 'absolute',
          left: 145,
          top: 319,
          width: 112,
          height: 44,
          background: palette.card,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fonts.sans,
          fontSize: 16,
          fontWeight: 500,
          color: palette.textMuted,
          cursor: 'pointer',
        }}
      >
        사진 추가
      </button>
      <div style={{ position: 'absolute', left: 16, top: 468, display: 'flex', flexDirection: 'row', gap: 8 }}>
        <div style={{ position: 'relative', width: 44, height: 44, borderRadius: 10, background: palette.beige }}>
          {/*
            삭제 배지 — cancelCircle.svg가 원과 X 표시를 한 벌로 갖고 있고 색도
            #9A9088이라, 이전의 반투명 원 div와 글리프를 통째로 대체한다.
          */}
          <img
            src={uiSvg.cancelCircle}
            width={22}
            height={22}
            alt=""
            style={{ position: 'absolute', left: 11, top: 11, display: 'block', cursor: 'pointer' }}
          />
        </div>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: palette.beige }} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 534,
          width: 402,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: 20,
          color: palette.text,
        }}
      >
        오늘 이곳에서 우리는?
      </div>
      <FlowerRating
        value={rating}
        onChange={setRating}
        size={26}
        letterSpacing={16}
        style={{ position: 'absolute', left: 0, top: 562, width: 402, justifyContent: 'center' }}
      />
      <div
        style={{
          position: 'absolute',
          left: 16,
          top: 608,
          width: 370,
          height: 48,
          background: palette.card,
          borderRadius: 18,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          boxSizing: 'border-box',
          gap: 8,
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 200))}
          maxLength={200}
          placeholder="오늘 우리가 머문 곳에 한 줄을 남겨주세요!"
          style={{
            flex: 1,
            fontFamily: fonts.hand,
            fontSize: 20,
            color: palette.text,
            minWidth: 0,
          }}
        />
        <MaskIcon src={etcSvg.pencil} color={palette.textMuted} size={16} />
      </div>
      <style>{`input::placeholder { color: ${palette.textFaint}; }`}</style>
      <div
        style={{
          position: 'absolute',
          left: 16,
          top: 662,
          width: 370,
          textAlign: 'right',
          fontFamily: fonts.hand,
          fontSize: 20,
          color: palette.textMuted,
        }}
      >
        {text.length}/200
      </div>
      <div
        style={{
          position: 'absolute',
          left: 16,
          top: 684,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: '7px 16px',
          background: palette.card,
          borderRadius: 999,
          cursor: 'pointer',
          width: 'max-content',
        }}
      >
        {/* plusSketch는 색이 이미 #9A9088(textMuted)이라 img 그대로 쓴다 */}
        <img src={uiSvg.plusSketch} width={16} height={16} alt="" style={{ display: 'block' }} />
        <span style={{ fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>태그 추가</span>
      </div>
      <PrimaryButton label="저장" left={16} top={753} onClick={save} />
      <button
        onClick={() => navigate('/')}
        style={{
          position: 'absolute',
          left: 16,
          top: 817,
          width: 370,
          textAlign: 'center',
          fontFamily: fonts.sans,
          fontSize: 16,
          fontWeight: 400,
          color: palette.olive,
          cursor: 'pointer',
        }}
      >
        나중에 쓰기로 넘겨도 괜찮아
      </button>
    </Screen>
  );
}
