import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { palette, fonts } from '@/styles/tokens';
import { uiSvg } from '@assets/svg';
import Screen from '@/components/Screen';
import MaskIcon from '@/components/MaskIcon';
import BackButton from '@/components/BackButton';
import FlowerRating from '@/components/FlowerRating';
import { useApp, useRecord } from '@/data/store';
import { flowerByKey } from '@/data/fixtures';
import { formatEditDate, formatEditTime } from '@/data/format';

const labelStyle = { fontFamily: fonts.hand, fontSize: 20, color: palette.text };

/** 장소 상세 편집(기록 수정) — 세로 스크롤 화면 */
export default function RecordEdit() {
  const navigate = useNavigate();
  const { recordId } = useParams();
  const { ready, updateRecord } = useApp();
  const record = useRecord(recordId);

  const [draft, setDraft] = useState(null);

  if (ready && !record) return <Navigate to="/" replace />;
  if (!record) return null;

  const myEntry = record.entries.find((e) => e.memberId === 'me');
  const state = draft || {
    rating: record.rating,
    tags: record.tags,
    text: myEntry?.text || '',
  };
  const patch = (p) => setDraft({ ...state, ...p });

  const flower = flowerByKey(record.flower);

  const save = async () => {
    await updateRecord(recordId, { rating: state.rating, tags: state.tags, text: state.text });
    navigate(-1);
  };

  const whiteChip = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    padding: '0 18px',
    background: palette.white,
    borderRadius: 999,
  };

  return (
    <Screen>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 402, height: 874, overflowY: 'auto' }} className="sheet-scroll">
        <div style={{ position: 'relative', width: 402, height: 1150 }}>
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
            기록 수정
          </div>
          {/* 사진 — 업로드 전 자리 */}
          <div style={{ position: 'absolute', left: 16, top: 139, width: 370, height: 245, borderRadius: 24, background: palette.beige }} />
          <button
            style={{
              position: 'absolute',
              left: 145,
              top: 239,
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
            사진 편집
          </button>

          <div style={{ position: 'absolute', left: 16, top: 400, ...labelStyle }}>장소</div>
          <div
            style={{
              position: 'absolute',
              left: 16,
              top: 430,
              width: 370,
              height: 48,
              background: palette.white,
              borderRadius: 14,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 16px',
              boxSizing: 'border-box',
            }}
          >
            <span style={{ fontFamily: fonts.hand, fontSize: 20, color: palette.text }}>{record.placeName}</span>
            <MaskIcon src={uiSvg.search} color={palette.text} size={20} />
          </div>

          <div style={{ position: 'absolute', left: 16, top: 487, ...labelStyle }}>날짜, 시간</div>
          <div style={{ position: 'absolute', left: 16, top: 517, display: 'flex', flexDirection: 'row', gap: 14 }}>
            <div style={whiteChip}>
              <MaskIcon src={uiSvg.schedule} color={palette.text} size={16} />
              <span style={{ fontFamily: fonts.hand, fontSize: 20, color: palette.text }}>{formatEditDate(record.date)}</span>
              <MaskIcon src={uiSvg.expandDown} color={palette.text} size={14} />
            </div>
            <div style={whiteChip}>
              <MaskIcon src={uiSvg.time} color={palette.text} size={16} />
              <span style={{ fontFamily: fonts.hand, fontSize: 20, color: palette.text }}>{formatEditTime(record.date)}</span>
              <MaskIcon src={uiSvg.expandDown} color={palette.text} size={14} />
            </div>
          </div>

          <div style={{ position: 'absolute', left: 16, top: 574, ...labelStyle }}>꽃갈피 편집</div>
          <div
            onClick={() => navigate('/pick', { state: { recordId } })}
            style={{ position: 'absolute', left: 16, top: 604, width: 'max-content', cursor: 'pointer', ...whiteChip }}
          >
            <span style={{ width: 16, height: 16, borderRadius: '50%', background: flower?.color || palette.beige }} />
            <span style={{ fontFamily: fonts.hand, fontSize: 20, color: palette.text }}>{flower?.name || '꽃갈피 선택'}</span>
            <MaskIcon src={uiSvg.expandDown} color={palette.text} size={14} />
          </div>

          <div style={{ position: 'absolute', left: 16, top: 661, ...labelStyle }}>별점</div>
          <FlowerRating
            value={state.rating}
            onChange={(v) => patch({ rating: v })}
            size={26}
            letterSpacing={14}
            style={{ position: 'absolute', left: 16, top: 686 }}
          />

          <div style={{ position: 'absolute', left: 16, top: 730, ...labelStyle }}>태그</div>
          <div style={{ position: 'absolute', left: 16, top: 760, display: 'flex', flexDirection: 'row', gap: 12, width: 370, flexWrap: 'wrap' }}>
            {state.tags.map((tag, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  background: palette.white,
                  borderRadius: 999,
                }}
              >
                <span
                  style={{
                    fontFamily: fonts.hand,
                    fontSize: 20,
                    color: palette.textMuted,
                    maxWidth: 150,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tag}
                </span>
                {/* cancelCircle.svg가 원+X 한 벌이고 색도 #9A9088이라 원 div가 필요 없다 */}
                <img
                  src={uiSvg.cancelCircle}
                  width={18}
                  height={18}
                  alt="태그 삭제"
                  onClick={() => patch({ tags: state.tags.filter((_, j) => j !== i) })}
                  style={{ display: 'block', flexShrink: 0, cursor: 'pointer' }}
                />
              </div>
            ))}
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                background: palette.card,
                borderRadius: 999,
                cursor: 'pointer',
              }}
            >
              <img src={uiSvg.plusSketch} width={16} height={16} alt="" style={{ display: 'block' }} />
              <span style={{ fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>태그 추가</span>
            </div>
          </div>

          <div style={{ position: 'absolute', left: 16, top: 813, ...labelStyle }}>한 줄</div>
          <textarea
            value={state.text}
            onChange={(e) => patch({ text: e.target.value.slice(0, 200) })}
            maxLength={200}
            style={{
              position: 'absolute',
              left: 16,
              top: 843,
              width: 370,
              height: 170,
              background: palette.white,
              borderRadius: 16,
              padding: 16,
              boxSizing: 'border-box',
              fontFamily: fonts.hand,
              fontSize: 20,
              color: palette.textMuted,
              lineHeight: 1.9,
              resize: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 16,
              top: 1018,
              width: 370,
              textAlign: 'right',
              fontFamily: fonts.hand,
              fontSize: 20,
              color: palette.textMuted,
            }}
          >
            {state.text.length}/200
          </div>
          <button
            onClick={save}
            style={{
              position: 'absolute',
              left: 16,
              top: 1045,
              width: 370,
              height: 54,
              background: palette.olive,
              borderRadius: 999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: fonts.sans,
              fontSize: 20,
              fontWeight: 500,
              color: palette.onOlive,
              cursor: 'pointer',
            }}
          >
            수정하기
          </button>
        </div>
      </div>
    </Screen>
  );
}
