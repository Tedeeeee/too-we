import { useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { palette, fonts } from '@/styles/tokens';
import { uiSvg } from '@assets/svg';
import Screen from '@/components/Screen';
import MaskIcon from '@/components/MaskIcon';
import BackButton from '@/components/BackButton';
import FlowerRating from '@/components/FlowerRating';
import VisitPhotoManager from '@/components/VisitPhotoManager';
import { useApp, useRecord } from '@/data/store';
import { FLOWERS } from '@/data/fixtures';
import { toAppError, userMessage } from '@/data/errors';

const labelStyle = { fontFamily: fonts.hand, fontSize: 20, color: palette.text };
const pad2 = (value) => String(value).padStart(2, '0');

const localDateAndTime = (iso) => {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return { date: '', time: '' };
  return {
    date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
  };
};

const combineLocalDateAndTime = (dateValue, timeValue) => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;
  const [, year, month, day] = dateMatch.map(Number);
  const [, hour, minute] = timeMatch.map(Number);
  const combined = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    combined.getFullYear() !== year
    || combined.getMonth() !== month - 1
    || combined.getDate() !== day
    || combined.getHours() !== hour
    || combined.getMinutes() !== minute
  ) return null;
  return combined.toISOString();
};

const clonePlace = (place) => (
  place && typeof place === 'object' ? { ...place } : place
);

const freezeDraftSnapshot = (draft) => {
  const place = clonePlace(draft.place);
  const tags = Object.freeze(Array.isArray(draft.tags) ? draft.tags.slice() : []);
  return Object.freeze({
    place: place && typeof place === 'object' ? Object.freeze(place) : place,
    date: draft.date,
    time: draft.time,
    flower: draft.flower || null,
    tags,
    text: draft.text,
    rating: draft.rating,
  });
};

/** 장소 상세 편집(기록 수정) — 공동 필드와 내 개인 필드만 한 번에 저장한다. */
export default function RecordEdit() {
  const navigate = useNavigate();
  const location = useLocation();
  const { recordId } = useParams();
  const {
    ready,
    updateRecord,
    addVisitPhotos,
    deleteVisitPhoto,
    retryDeleteVisitPhoto,
    photoUploadsByRecord,
    photoDeletesByRecord,
  } = useApp();
  const record = useRecord(recordId);
  const [draft, setDraft] = useState(null);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(false);

  if (ready && !record) return <Navigate to="/" replace />;
  if (!record) return null;

  const myEntry = record.entries?.find((entry) => entry.memberId === 'me');
  const partnerEntry = record.entries?.find((entry) => entry.memberId === 'partner');
  const initialDate = localDateAndTime(record.date);
  const returnedDraft = location.state?.draft;
  const returnedPlace = location.state?.place;
  const state = draft || {
    place: clonePlace(returnedDraft?.place || returnedPlace || record.place || {
      id: record.placeId,
      providerId: record.placeId,
      provider: 'kakao',
      name: record.placeName,
    }),
    date: typeof returnedDraft?.date === 'string' ? returnedDraft.date : initialDate.date,
    time: typeof returnedDraft?.time === 'string' ? returnedDraft.time : initialDate.time,
    rating: Number.isInteger(returnedDraft?.rating)
      ? returnedDraft.rating
      : Number.isInteger(myEntry?.rating)
      ? myEntry.rating
      : Number.isInteger(record.rating) ? record.rating : 0,
    flower: returnedDraft && Object.hasOwn(returnedDraft, 'flower')
      ? returnedDraft.flower ?? ''
      : record.flower ?? '',
    tags: Array.isArray(returnedDraft?.tags)
      ? returnedDraft.tags.slice()
      : Array.isArray(record.tags) ? record.tags.slice() : [],
    text: typeof returnedDraft?.text === 'string' ? returnedDraft.text : myEntry?.text ?? '',
  };

  const patch = (next) => {
    setDraft({ ...state, ...next });
    setError(null);
  };

  const addTag = () => {
    const tag = newTag.trim();
    if (!tag) return;
    patch({ tags: [...state.tags, tag] });
    setNewTag('');
    setAddingTag(false);
  };

  const save = async () => {
    if (inFlightRef.current) return;
    const date = combineLocalDateAndTime(state.date, state.time);
    if (!date) {
      setError({ message: '방문 날짜와 시간을 다시 확인해 주세요.' });
      return;
    }

    const payload = {
      place: state.place,
      date,
      flower: state.flower || null,
      tags: state.tags,
      text: state.text.trim(),
      rating: state.rating,
    };
    inFlightRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await updateRecord(recordId, payload);
      navigate(-1);
    } catch (nextError) {
      const appError = toAppError(nextError);
      setError({ message: userMessage(appError.code), retryable: appError.retryable });
    } finally {
      inFlightRef.current = false;
      setSaving(false);
    }
  };

  const whiteChip = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    padding: '0 14px',
    background: palette.white,
    borderRadius: 999,
    boxSizing: 'border-box',
  };

  return (
    <Screen>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 402, height: 874, overflowY: 'auto' }} className="sheet-scroll">
        <div style={{ position: 'relative', width: 402, height: 1260 }}>
          <BackButton left={16} top={82} />
          <div style={{ position: 'absolute', left: 0, top: 88, width: 402, textAlign: 'center', fontFamily: fonts.hand, fontSize: 28, color: palette.text }}>
            기록 수정
          </div>

          <VisitPhotoManager
            recordId={recordId}
            photos={record.photos}
            uploads={photoUploadsByRecord?.[recordId] ?? []}
            deleteStates={photoDeletesByRecord?.[recordId] ?? {}}
            addPhotos={addVisitPhotos}
            deletePhoto={deleteVisitPhoto}
            retryDeletePhoto={retryDeleteVisitPhoto}
            disabled={saving}
            label="사진 편집"
            style={{ left: 16, top: 139, width: 370, height: 245 }}
          />

          <div style={{ position: 'absolute', left: 16, top: 400, ...labelStyle }}>장소</div>
          <button
            type="button"
            aria-label="장소"
            disabled={saving}
            onClick={() => navigate('/map', {
              replace: true,
              state: Object.freeze({
                intent: 'edit-record-place',
                recordId,
                draft: freezeDraftSnapshot(state),
              }),
            })}
            style={{ position: 'absolute', left: 16, top: 430, width: 370, height: 48, background: palette.white, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', boxSizing: 'border-box', cursor: 'pointer' }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: fonts.hand, fontSize: 20, color: palette.text }}>{state.place?.name || record.placeName}</span>
            <MaskIcon src={uiSvg.search} color={palette.text} size={20} />
          </button>

          <div style={{ position: 'absolute', left: 16, top: 487, ...labelStyle }}>날짜, 시간</div>
          <fieldset disabled={saving} style={{ position: 'absolute', left: 16, top: 517, display: 'flex', flexDirection: 'row', gap: 10, border: 0, padding: 0, margin: 0 }}>
            <label style={{ ...whiteChip, width: 218 }}>
              <MaskIcon src={uiSvg.schedule} color={palette.text} size={16} />
              <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)' }}>방문 날짜</span>
              <input
                aria-label="방문 날짜"
                type="date"
                value={state.date}
                onChange={(event) => patch({ date: event.target.value })}
                style={{ minWidth: 0, width: 160, fontFamily: fonts.hand, fontSize: 16, color: palette.text }}
              />
            </label>
            <label style={{ ...whiteChip, width: 142 }}>
              <MaskIcon src={uiSvg.time} color={palette.text} size={16} />
              <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)' }}>방문 시간</span>
              <input
                aria-label="방문 시간"
                type="time"
                value={state.time}
                onChange={(event) => patch({ time: event.target.value })}
                style={{ minWidth: 0, width: 90, fontFamily: fonts.hand, fontSize: 16, color: palette.text }}
              />
            </label>
          </fieldset>

          <div style={{ position: 'absolute', left: 16, top: 574, ...labelStyle }}>꽃갈피 편집</div>
          <label style={{ position: 'absolute', left: 16, top: 604, width: 210, ...whiteChip }}>
            <span style={{ width: 16, height: 16, flexShrink: 0, borderRadius: '50%', background: FLOWERS.find((item) => item.key === state.flower)?.color || palette.beige }} />
            <select
              aria-label="꽃갈피"
              disabled={saving}
              value={state.flower}
              onChange={(event) => patch({ flower: event.target.value })}
              style={{ flex: 1, minWidth: 0, fontFamily: fonts.hand, fontSize: 18, color: palette.text, background: 'transparent' }}
            >
              <option value="">선택 없음</option>
              {FLOWERS.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
            </select>
          </label>

          <div style={{ position: 'absolute', left: 16, top: 661, ...labelStyle }}>별점</div>
          <FlowerRating value={state.rating} onChange={(rating) => patch({ rating })} allowClear size={26} letterSpacing={14} style={{ position: 'absolute', left: 16, top: 686 }} />

          <div style={{ position: 'absolute', left: 16, top: 730, ...labelStyle }}>태그</div>
          <div style={{ position: 'absolute', left: 16, top: 760, display: 'flex', flexDirection: 'row', gap: 10, width: 370, flexWrap: 'wrap' }}>
            {state.tags.map((tag, index) => (
              <div key={`${tag}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: palette.white, borderRadius: 999 }}>
                <span style={{ fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tag}</span>
                <button type="button" aria-label={`${tag} 태그 삭제`} disabled={saving} onClick={() => patch({ tags: state.tags.filter((_, tagIndex) => tagIndex !== index) })}>
                  <img src={uiSvg.cancelCircle} width={18} height={18} alt="" style={{ display: 'block' }} />
                </button>
              </div>
            ))}
            {addingTag ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input aria-label="새 태그" value={newTag} maxLength={80} onChange={(event) => setNewTag(event.target.value)} style={{ width: 120, height: 36, padding: '0 12px', background: palette.white, borderRadius: 999, fontFamily: fonts.hand, fontSize: 18 }} />
                <button type="button" onClick={addTag} style={{ height: 36, padding: '0 12px', borderRadius: 999, background: palette.olive, color: palette.onOlive, fontFamily: fonts.hand }}>태그 넣기</button>
              </div>
            ) : (
              <button type="button" disabled={saving} onClick={() => setAddingTag(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: palette.card, borderRadius: 999, cursor: 'pointer' }}>
                <img src={uiSvg.plusSketch} width={16} height={16} alt="" />
                <span style={{ fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>태그 추가</span>
              </button>
            )}
          </div>

          <div style={{ position: 'absolute', left: 16, top: 850, ...labelStyle }}>한 줄</div>
          <textarea
            aria-label="내 한 줄"
            disabled={saving}
            value={state.text}
            onChange={(event) => patch({ text: event.target.value.slice(0, 200) })}
            maxLength={200}
            style={{ position: 'absolute', left: 16, top: 880, width: 370, height: 140, background: palette.white, borderRadius: 16, padding: 16, boxSizing: 'border-box', fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted, lineHeight: 1.7, resize: 'none' }}
          />
          <div style={{ position: 'absolute', left: 16, top: 1022, width: 370, textAlign: 'right', fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>{state.text.length}/200</div>

          <div aria-label="짝궁 기록 (읽기 전용)" style={{ position: 'absolute', left: 16, top: 1054, width: 370, padding: '12px 16px', boxSizing: 'border-box', borderRadius: 16, background: palette.card, fontFamily: fonts.hand, fontSize: 18, color: palette.textMuted }}>
            짝궁: {partnerEntry?.text || '한 줄 없음'} · {partnerEntry?.rating || 0}점
          </div>

          {saving && <p role="status" aria-live="polite" aria-busy="true" style={{ position: 'absolute', left: 16, top: 1115, width: 370, margin: 0, textAlign: 'center', fontFamily: fonts.hand, color: palette.textMuted }}>기록을 저장하고 있어요…</p>}
          {error && <p role="alert" aria-live="assertive" style={{ position: 'absolute', left: 16, top: 1115, width: 370, margin: 0, textAlign: 'center', fontFamily: fonts.hand, color: palette.textMuted }}>{error.message}</p>}
          <button
            type="button"
            disabled={saving}
            onClick={save}
            style={{ position: 'absolute', left: 16, top: 1150, width: 370, height: 54, background: palette.olive, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.sans, fontSize: 20, fontWeight: 500, color: palette.onOlive, cursor: 'pointer' }}
          >
            {saving ? '저장 중…' : error ? '다시 저장' : '수정하기'}
          </button>
        </div>
      </div>
    </Screen>
  );
}
