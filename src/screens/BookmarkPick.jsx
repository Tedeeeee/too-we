import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { palette } from '@/styles/tokens';
import Screen from '@/components/Screen';
import FlowerPickSheet from '@/components/FlowerPickSheet';
import { FLOWERS } from '@/data/fixtures';
import { useApp, useRecord } from '@/data/store';

/**
 * 꽃갈피 선택 화면 (딤 배경 + 바텀시트).
 * 선택 확정 시 홈 → 장소 상세 순으로 스택을 재구성한다
 * (프로토타입 confirmPick: screen='detail', stack=['main']).
 */
export default function BookmarkPick() {
  const navigate = useNavigate();
  const location = useLocation();
  const recordId = location.state?.recordId;
  const { ready, setRecordFlower } = useApp();
  const record = useRecord(recordId);
  const [selected, setSelected] = useState(() => (
    FLOWERS.some((flower) => flower.key === record?.flower) ? record.flower : null
  ));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!recordId) return <Navigate to="/" replace />;
  if (!ready) return null;
  if (!record) return <Navigate to="/" replace />;

  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await setRecordFlower(recordId, selected);
      // back 시 홈으로 가도록 히스토리를 [홈, 상세]로 재구성
      navigate('/', { replace: true });
      navigate(`/place/${recordId}`);
    } catch (saveError) {
      console.error(saveError);
      setError('저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <div
        onClick={() => navigate(-1)}
        style={{ position: 'absolute', left: 0, top: 0, width: 402, height: 874, background: palette.dim, cursor: 'pointer' }}
      />
      <FlowerPickSheet
        selected={selected}
        onSelect={setSelected}
        onConfirm={confirm}
        saving={saving}
        error={error}
      />
    </Screen>
  );
}
