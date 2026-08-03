import { useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { palette, fonts } from '@/styles/tokens';
import { uiSvg, etcSvg } from '@assets/svg';
import Screen from '@/components/Screen';
import MaskIcon from '@/components/MaskIcon';
import BackButton from '@/components/BackButton';
import PrimaryButton from '@/components/PrimaryButton';
import FlowerRating from '@/components/FlowerRating';
import { useApp, useRecord } from '@/data/store';
import { toAppError, userMessage } from '@/data/errors';
import { formatRecordDate } from '@/data/format';

const pad2 = (value) => String(value).padStart(2, '0');

const newVisitRequestKey = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `visit-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const localVisitIntent = (date) => ({
  date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
  time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
});

const combineLocalVisitIntent = (dateValue, timeValue) => {
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
  ) {
    return null;
  }
  return combined.toISOString();
};

const validCoordinate = (value, min, max) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

const isNormalizedPlace = (place) =>
  Boolean(
    place
      && typeof place === 'object'
      && !Array.isArray(place)
      && typeof place.id === 'string'
      && place.id.trim()
      && typeof place.name === 'string'
      && place.name.trim()
      && typeof place.provider === 'string'
      && place.provider.trim()
      && validCoordinate(place.lat, -90, 90)
      && validCoordinate(place.lng, -180, 180),
  );

function BlankVisitForm({ navigate, place, saveFiveSecondRecord }) {
  const defaults = useMemo(() => localVisitIntent(new Date()), []);
  const [dateValue, setDateValue] = useState(defaults.date);
  const [timeValue, setTimeValue] = useState(defaults.time);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(false);
  const requestKeyRef = useRef(null);

  const editIntent = (setter) => (event) => {
    requestKeyRef.current = null;
    setError(null);
    setter(event.target.value);
  };

  const save = async () => {
    if (inFlightRef.current) return;
    const date = combineLocalVisitIntent(dateValue, timeValue);
    if (!date) {
      requestKeyRef.current = null;
      setError({ message: '방문 날짜와 시간을 다시 확인해 주세요.', retryable: false });
      return;
    }

    inFlightRef.current = true;
    setSaving(true);
    setError(null);
    requestKeyRef.current ??= newVisitRequestKey();

    try {
      await saveFiveSecondRecord({ place, date, requestKey: requestKeyRef.current });
      requestKeyRef.current = null;
      navigate('/', { replace: true });
    } catch (nextError) {
      const appError = toAppError(nextError);
      if (!appError.retryable) requestKeyRef.current = null;
      setError({ message: userMessage(appError.code), retryable: appError.retryable });
    } finally {
      inFlightRef.current = false;
      setSaving(false);
    }
  };

  const inputStyle = {
    width: 322,
    height: 50,
    padding: '0 16px',
    border: `1px solid ${palette.beige}`,
    borderRadius: 16,
    boxSizing: 'border-box',
    background: palette.white,
    color: palette.text,
    fontFamily: fonts.sans,
    fontSize: 18,
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
        새 방문 기록
      </div>
      <div
        style={{
          position: 'absolute',
          left: 16,
          top: 149,
          width: 370,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: fonts.hand,
          fontSize: 32,
          color: palette.textStrong,
        }}
      >
        {place.name}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 16,
          top: 190,
          width: 370,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: fonts.hand,
          fontSize: 20,
          color: palette.textMuted,
        }}
      >
        {[place.category, place.roadAddress || place.address].filter(Boolean).join(' · ')}
      </div>

      <fieldset disabled={saving} style={{ display: 'contents' }}>
        <div
          style={{
            position: 'absolute',
            left: 16,
            top: 238,
            width: 370,
            height: 330,
            padding: '30px 24px',
            border: 0,
            borderRadius: 24,
            boxSizing: 'border-box',
            background: palette.card,
          }}
        >
          <div style={{ marginBottom: 24, fontFamily: fonts.hand, fontSize: 26, color: palette.textStrong }}>
            언제 함께 다녀왔나요?
          </div>
          <label htmlFor="blank-visit-date" style={{ display: 'block', marginBottom: 8, fontFamily: fonts.sans, fontSize: 15, color: palette.textMuted }}>
            방문 날짜
          </label>
          <input
            id="blank-visit-date"
            type="date"
            required
            value={dateValue}
            onChange={editIntent(setDateValue)}
            style={inputStyle}
          />
          <label htmlFor="blank-visit-time" style={{ display: 'block', marginTop: 20, marginBottom: 8, fontFamily: fonts.sans, fontSize: 15, color: palette.textMuted }}>
            방문 시간
          </label>
          <input
            id="blank-visit-time"
            type="time"
            required
            value={timeValue}
            onChange={editIntent(setTimeValue)}
            style={inputStyle}
          />
        </div>
        <PrimaryButton
          label={saving ? '저장 중…' : error ? '다시 저장' : '빈 방문 저장'}
          left={16}
          top={753}
          disabled={saving}
          onClick={save}
        />
      </fieldset>

      <div
        style={{
          position: 'absolute',
          left: 32,
          top: 604,
          width: 338,
          textAlign: 'center',
          fontFamily: fonts.hand,
          fontSize: 20,
          lineHeight: 1.45,
          color: palette.textMuted,
        }}
      >
        한 줄과 별점, 사진, 태그, 꽃갈피는 나중에 남겨도 괜찮아요.
      </div>
      {saving && (
        <p
          role="status"
          aria-live="polite"
          aria-busy="true"
          style={{ position: 'absolute', left: 32, top: 670, width: 338, margin: 0, textAlign: 'center', fontFamily: fonts.sans, fontSize: 15, color: palette.text }}
        >
          방문 기록을 저장하고 있어요…
        </p>
      )}
      {error && (
        <p
          role="alert"
          aria-live="assertive"
          style={{ position: 'absolute', left: 32, top: 670, width: 338, margin: 0, textAlign: 'center', fontFamily: fonts.sans, fontSize: 15, lineHeight: 1.45, color: palette.text }}
        >
          {error.message}
        </p>
      )}
      <button
        type="button"
        disabled={saving}
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
        취소하고 홈으로
      </button>
    </Screen>
  );
}

/** Wave 4에서 완성할 기존 대기 기록 한 줄 작성 화면. */
function PendingRecordCompletion({
  navigate,
  pendingRecord,
  recordId,
  placeId,
  placeName,
  saveFiveSecondRecord,
}) {
  const [text, setText] = useState('');
  const [rating, setRating] = useState(3);
  const [saving, setSaving] = useState(false);
  const now = useMemo(() => new Date().toISOString(), []);
  const title = pendingRecord?.placeName || placeName || '';
  const dateLabel = formatRecordDate(pendingRecord?.date || now);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const record = await saveFiveSecondRecord({ recordId, placeId, text: text.trim(), rating, date: now });
    navigate('/pick', { state: { recordId: record.id } });
  };

  return (
    <Screen>
      <BackButton left={16} top={82} />
      <div style={{ position: 'absolute', left: 0, top: 88, width: 402, textAlign: 'center', fontFamily: fonts.hand, fontSize: 28, color: palette.text }}>
        5초 기록
      </div>
      <div style={{ position: 'absolute', left: 16, top: 149, fontFamily: fonts.hand, fontSize: 32, color: palette.textStrong }}>
        {title}
      </div>
      <div style={{ position: 'absolute', left: 16, top: 187, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>{dateLabel}</span>
        <MaskIcon src={etcSvg.pencil} color={palette.textMuted} size={16} />
      </div>
      <div style={{ position: 'absolute', left: 16, top: 226, width: 370, height: 230, borderRadius: 24, background: palette.beige }} />
      <button
        style={{ position: 'absolute', left: 145, top: 319, width: 112, height: 44, background: palette.card, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.sans, fontSize: 16, fontWeight: 500, color: palette.textMuted, cursor: 'pointer' }}
      >
        사진 추가
      </button>
      <div style={{ position: 'absolute', left: 16, top: 468, display: 'flex', flexDirection: 'row', gap: 8 }}>
        <div style={{ position: 'relative', width: 44, height: 44, borderRadius: 10, background: palette.beige }}>
          <img src={uiSvg.cancelCircle} width={22} height={22} alt="" style={{ position: 'absolute', left: 11, top: 11, display: 'block', cursor: 'pointer' }} />
        </div>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: palette.beige }} />
      </div>
      <div style={{ position: 'absolute', left: 0, top: 534, width: 402, textAlign: 'center', fontFamily: fonts.hand, fontSize: 20, color: palette.text }}>
        오늘 이곳에서 우리는?
      </div>
      <FlowerRating
        value={rating}
        onChange={setRating}
        size={26}
        letterSpacing={16}
        style={{ position: 'absolute', left: 0, top: 562, width: 402, justifyContent: 'center' }}
      />
      <div style={{ position: 'absolute', left: 16, top: 608, width: 370, height: 48, background: palette.card, borderRadius: 18, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', boxSizing: 'border-box', gap: 8 }}>
        <input
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, 200))}
          maxLength={200}
          placeholder="오늘 우리가 머문 곳에 한 줄을 남겨주세요!"
          style={{ flex: 1, fontFamily: fonts.hand, fontSize: 20, color: palette.text, minWidth: 0 }}
        />
        <MaskIcon src={etcSvg.pencil} color={palette.textMuted} size={16} />
      </div>
      <style>{`input::placeholder { color: ${palette.textFaint}; }`}</style>
      <div style={{ position: 'absolute', left: 16, top: 662, width: 370, textAlign: 'right', fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>
        {text.length}/200
      </div>
      <div style={{ position: 'absolute', left: 16, top: 684, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, padding: '7px 16px', background: palette.card, borderRadius: 999, cursor: 'pointer', width: 'max-content' }}>
        <img src={uiSvg.plusSketch} width={16} height={16} alt="" style={{ display: 'block' }} />
        <span style={{ fontFamily: fonts.hand, fontSize: 20, color: palette.textMuted }}>태그 추가</span>
      </div>
      <PrimaryButton label="저장" left={16} top={753} onClick={save} />
      <button
        onClick={() => navigate('/')}
        style={{ position: 'absolute', left: 16, top: 817, width: 370, textAlign: 'center', fontFamily: fonts.sans, fontSize: 16, fontWeight: 400, color: palette.olive, cursor: 'pointer' }}
      >
        나중에 쓰기로 넘겨도 괜찮아
      </button>
    </Screen>
  );
}

/** 장소 선택 뒤 빈 방문을 만들거나, 기존 대기 기록의 내 한 줄을 완성한다. */
export default function RecordNew() {
  const navigate = useNavigate();
  const location = useLocation();
  const { saveFiveSecondRecord } = useApp();
  const { recordId, placeId, placeName } = location.state || {};
  const pendingRecord = useRecord(recordId);

  if (recordId) {
    return (
      <PendingRecordCompletion
        navigate={navigate}
        pendingRecord={pendingRecord}
        recordId={recordId}
        placeId={placeId}
        placeName={placeName}
        saveFiveSecondRecord={saveFiveSecondRecord}
      />
    );
  }

  const place = location.state?.place;
  if (!isNormalizedPlace(place)) {
    return <Navigate to="/map" replace state={{ intent: 'new-record' }} />;
  }

  return <BlankVisitForm navigate={navigate} place={place} saveFiveSecondRecord={saveFiveSecondRecord} />;
}
