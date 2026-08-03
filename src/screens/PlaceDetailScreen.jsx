import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import PlaceDetail from '@/components/PlaceDetail';
import { useApp, useRecord } from '@/data/store';
import { seasonFromDate } from '@/data/format';

/**
 * 장소 상세.
 *
 * 계절은 **기록 날짜의 월**로 결정된다 — 이전에는 `›` 버튼으로 4계절을 순환했는데
 * 시안에는 그런 전환이 없다. 시안의 봄/여름/가을/겨울 4화면은 `section.screen`
 * 배경색만 다르고 나머지(메모 영역 포함)는 완전히 동일하다.
 *
 * 히어로 상단의 화살표와 `n/m`은 **사진 페이저**다(시안 표기는 `1/5`).
 * 사진이 2장 미만이면 넘길 것이 없으므로 숨긴다.
 */
export default function PlaceDetailScreen() {
  const navigate = useNavigate();
  const { recordId } = useParams();
  const { couple, ready, retryRecords } = useApp();
  const record = useRecord(recordId);
  const [photoIdx, setPhotoIdx] = useState(0);

  if (ready && !record) return <Navigate to="/" replace />;
  if (!record) return null;

  const photos = (Array.isArray(record.photos) ? record.photos : [])
    .slice()
    .sort((a, b) => Number(a?.order ?? a?.ordinal ?? 0) - Number(b?.order ?? b?.ordinal ?? 0));
  const photoCount = photos.length;
  // 시안에 오른쪽 화살표가 하나뿐이라 순환으로 전체를 돌 수 있게 한다
  const nextPhoto = photoCount > 1 ? () => setPhotoIdx((i) => (i + 1) % photoCount) : undefined;

  return (
    <PlaceDetail
      record={{ ...record, photos }}
      couple={couple}
      season={seasonFromDate(record.date)}
      photoIndex={Math.min(photoIdx, Math.max(photoCount - 1, 0))}
      onNextPhoto={nextPhoto}
      onRetryPhotos={retryRecords}
      onBack={() => navigate(-1)}
      onOpenPick={() => navigate('/pick', { state: { recordId } })}
      onOpenEdit={() => navigate(`/place/${recordId}/edit`)}
    />
  );
}
