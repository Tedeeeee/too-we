import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { palette, fonts, shadows } from '@/styles/tokens';
import { uiSvg } from '@assets/svg';
import Screen from '@/components/Screen';
import MaskIcon from '@/components/MaskIcon';
import BackButton from '@/components/BackButton';
import { useApp } from '@/data/store';

const PLACE_SNAPSHOT_KEYS = [
  'id',
  'providerId',
  'provider_id',
  'provider',
  'name',
  'category',
  'address',
  'roadAddress',
  'road_address',
  'phone',
  'url',
  'lat',
  'lng',
  'walk',
];

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const freezePlaceSnapshot = (place) => {
  if (!place || typeof place !== 'object' || Array.isArray(place)) return null;
  const snapshot = {};
  PLACE_SNAPSHOT_KEYS.forEach((key) => {
    if (Object.hasOwn(place, key)) snapshot[key] = place[key];
  });
  if (typeof snapshot.name !== 'string' || !snapshot.name.trim()) return null;
  return Object.freeze(snapshot);
};

const actionFailureCopy = {
  create: {
    message: '장소를 추가하지 못했어요. 선택한 장소는 유지했어요.',
    retry: '추가 다시 시도',
  },
  update: {
    message: '장소를 변경하지 못했어요. 선택한 장소는 유지했어요.',
    retry: '변경 다시 시도',
  },
  delete: {
    message: '장소를 삭제하지 못했어요. 목록은 그대로예요.',
    retry: '삭제 다시 시도',
  },
};

const compactActionStyle = {
  width: 46,
  height: 20,
  borderRadius: 999,
  boxShadow: `inset 0 0 0 1px ${palette.hairline}`,
  color: palette.textMuted,
  fontFamily: fonts.sans,
  fontSize: 12,
  lineHeight: '20px',
  cursor: 'pointer',
};

const feedbackStyle = {
  alignSelf: 'stretch',
  borderRadius: 12,
  padding: '11px 14px',
  background: palette.card,
  color: palette.text,
  fontFamily: fonts.hand,
  fontSize: 18,
  lineHeight: 1.35,
  boxShadow: `inset 0 0 0 1px ${palette.hairline}`,
};

/** 가고 싶은 곳 — 공유 목록을 방문 기록과 분리해 조회·추가·변경·삭제한다. */
export default function Wishlist() {
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const {
    wishlist,
    wishlistStatus,
    retryWishlist,
    createWishlistPlace,
    updateWishlistPlace,
    deleteWishlistPlace,
  } = useApp();
  const [pendingAction, setPendingAction] = useState(null);
  const [failedAction, setFailedAction] = useState(null);
  const [recordNotice, setRecordNotice] = useState(false);
  const activeOperationRef = useRef(null);
  const handledIntentKeyRef = useRef(null);
  const mountedRef = useRef(true);

  const items = Array.isArray(wishlist) ? wishlist : [];

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runAction = useCallback((action) => {
    if (!action || activeOperationRef.current) return activeOperationRef.current;

    if (mountedRef.current) {
      setPendingAction(action);
      setFailedAction(null);
    }
    const operation = Promise.resolve()
      .then(() => {
        if (action.type === 'create') {
          return createWishlistPlace(action.place);
        }
        if (action.type === 'update') {
          return updateWishlistPlace(action.wishlistId, action.place);
        }
        return deleteWishlistPlace(action.wishlistId);
      })
      .catch(() => {
        if (mountedRef.current) setFailedAction(action);
        return null;
      })
      .finally(() => {
        if (activeOperationRef.current === operation) activeOperationRef.current = null;
        if (mountedRef.current) setPendingAction(null);
      });

    activeOperationRef.current = operation;
    return operation;
  }, [createWishlistPlace, deleteWishlistPlace, updateWishlistPlace]);

  useEffect(() => {
    if (handledIntentKeyRef.current === routeLocation.key) return;
    const state = routeLocation.state;
    const place = freezePlaceSnapshot(state?.place);
    let action = null;

    if (state?.intent === 'wishlist-add' && place) {
      action = Object.freeze({ type: 'create', place });
    } else if (
      state?.intent === 'wishlist-edit'
      && typeof state.wishlistId === 'string'
      && state.wishlistId.trim()
      && place
    ) {
      action = Object.freeze({
        type: 'update',
        wishlistId: state.wishlistId.trim(),
        place,
      });
    }

    if (!action) return;
    handledIntentKeyRef.current = routeLocation.key;
    navigate('/mypage/wishlist', { replace: true, state: null });
    runAction(action);
  }, [navigate, routeLocation.key, routeLocation.state, runAction]);

  const openWishlistMap = (intent, wishlistId) => {
    if (activeOperationRef.current) return;
    const state = intent === 'wishlist-edit'
      ? Object.freeze({ intent, wishlistId })
      : Object.freeze({ intent });
    navigate('/map', { replace: true, state });
  };

  const requestDelete = (item) => {
    if (activeOperationRef.current) return;
    const confirmed = typeof globalThis.confirm === 'function'
      && globalThis.confirm(`${item.name}을(를) 가고 싶은 곳에서 삭제할까요?`);
    if (!confirmed) return;
    runAction(Object.freeze({ type: 'delete', wishlistId: item.id, placeName: item.name }));
  };

  const retryLoad = () => {
    Promise.resolve(retryWishlist()).catch(() => {});
  };

  const loadingWithoutData = wishlistStatus === 'loading' && items.length === 0;
  const loadErrorWithoutData = wishlistStatus === 'error'
    && items.length === 0
    && !failedAction
    && !pendingAction;
  const staleListError = wishlistStatus === 'error'
    && items.length > 0
    && !failedAction
    && !pendingAction;
  const failedCopy = failedAction ? actionFailureCopy[failedAction.type] : null;
  const failedPlaceName = failedAction?.place?.name || failedAction?.placeName;
  const isCreating = pendingAction?.type === 'create';

  return (
    <Screen bg={palette.bgAlt}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 75,
          width: 402,
          height: 799,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          alignItems: 'center',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            height: 52,
            display: 'flex',
            flexDirection: 'row',
            gap: 10,
            padding: '5px 16px',
            alignItems: 'center',
            boxSizing: 'border-box',
            alignSelf: 'stretch',
            flexShrink: 0,
          }}
        >
          <BackButton left={0} top={0} style={{ position: 'relative', flexShrink: 0 }} />
          <span style={{ fontFamily: fonts.hand, fontSize: 24, lineHeight: '100%', color: palette.text }}>가고 싶은 곳</span>
        </div>

        <div
          aria-busy={Boolean(pendingAction) || wishlistStatus === 'loading'}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: '5px 16px 28px',
            alignItems: 'flex-start',
            boxSizing: 'border-box',
            alignSelf: 'stretch',
          }}
        >
          <div style={{ height: 23, alignSelf: 'stretch' }}>
            <span style={{ fontFamily: fonts.hand, fontSize: 20, lineHeight: '100%', color: palette.text }}>다음엔 여기 어때?</span>
          </div>

          {loadingWithoutData && (
            <div role="status" aria-live="polite" style={feedbackStyle}>
              가고 싶은 곳을 불러오고 있어요…
            </div>
          )}

          {loadErrorWithoutData && (
            <div role="alert" aria-live="assertive" style={feedbackStyle}>
              <div>가고 싶은 곳을 불러오지 못했어요. 네트워크를 확인해 주세요.</div>
              <button
                type="button"
                aria-label="목록 다시 시도"
                onClick={retryLoad}
                style={{ ...compactActionStyle, width: 'auto', marginTop: 9, padding: '0 12px', color: palette.olive }}
              >
                다시 시도
              </button>
            </div>
          )}

          {staleListError && (
            <div role="alert" aria-live="polite" style={feedbackStyle}>
              <div>최신 목록을 확인하지 못했어요. 마지막으로 불러온 장소를 보여드려요.</div>
              <button
                type="button"
                aria-label="목록 다시 시도"
                onClick={retryLoad}
                style={{ ...compactActionStyle, width: 'auto', marginTop: 9, padding: '0 12px', color: palette.olive }}
              >
                다시 시도
              </button>
            </div>
          )}

          {failedAction && failedCopy && (
            <div role="alert" aria-live="assertive" style={feedbackStyle}>
              <div>{failedCopy.message}</div>
              {failedPlaceName && <div>{failedPlaceName}</div>}
              <button
                type="button"
                aria-label={failedCopy.retry}
                disabled={Boolean(pendingAction)}
                onClick={() => runAction(failedAction)}
                style={{
                  ...compactActionStyle,
                  width: 'auto',
                  marginTop: 9,
                  padding: '0 12px',
                  color: palette.olive,
                  opacity: pendingAction ? 0.55 : 1,
                }}
              >
                다시 시도
              </button>
            </div>
          )}

          {recordNotice && (
            <div role="status" aria-label="기록 안내" aria-live="polite" style={feedbackStyle}>
              방문 기록은 홈 화면 아래의 + 버튼에서 시작해요. 이 장소는 가고 싶은 곳에 그대로 남아 있어요.
            </div>
          )}
          <span id="wishlist-record-guidance" style={visuallyHidden}>
            방문 기록은 홈 화면 아래의 + 버튼에서만 시작하며, 이 버튼은 방문을 만들거나 저장하지 않습니다.
          </span>

          {!loadingWithoutData && !loadErrorWithoutData && items.length === 0 && (
            <div style={{ ...feedbackStyle, textAlign: 'center', color: palette.textMuted }}>
              아직 가고 싶은 곳이 없어요.
            </div>
          )}

          <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignSelf: 'stretch' }}>
            {items.map((item) => {
              const isUpdating = pendingAction?.type === 'update'
                && pendingAction.wishlistId === item.id;
              const isDeleting = pendingAction?.type === 'delete'
                && pendingAction.wishlistId === item.id;
              const actionsDisabled = Boolean(pendingAction);
              return (
                <div
                  role="listitem"
                  key={item.id}
                  style={{
                    height: 87.923,
                    borderRadius: 15.033,
                    background: palette.card,
                    boxShadow: `inset 0 0 0 0.835px ${palette.hairline}, ${shadows.card}`,
                    display: 'flex',
                    flexDirection: 'row',
                    gap: 13.363,
                    padding: 16.703,
                    alignItems: 'flex-start',
                    boxSizing: 'border-box',
                    alignSelf: 'stretch',
                    opacity: isDeleting ? 0.7 : 1,
                  }}
                >
                  <div style={{ width: 40, height: 40, borderRadius: 4.727, background: palette.photoFill, flexShrink: 0 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', flexGrow: 1, minWidth: 0 }}>
                    <span
                      style={{
                        borderRadius: 1.67,
                        background: palette.chipWish,
                        padding: '1px 6.681px',
                        fontFamily: fonts.hand,
                        fontSize: 16,
                        lineHeight: '100%',
                        letterSpacing: '-0.010em',
                        whiteSpace: 'nowrap',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: palette.text,
                      }}
                    >
                      {item.category || '장소'}
                    </span>
                    <span
                      style={{
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontFamily: fonts.hand,
                        fontSize: 20,
                        lineHeight: '18.374px',
                        whiteSpace: 'nowrap',
                        color: palette.textStrong,
                      }}
                    >
                      {item.name}
                    </span>
                    <span
                      style={{
                        fontFamily: fonts.hand,
                        fontSize: 20,
                        lineHeight: '100%',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '100%',
                        color: palette.textSubtle,
                      }}
                    >
                      {item.pickedBy || '우리'} Pick!
                    </span>
                  </div>

                  <div style={{ width: 96, display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      aria-label={`${item.name} 기록 안내`}
                      aria-describedby="wishlist-record-guidance"
                      onClick={() => setRecordNotice(true)}
                      style={{
                        width: 96,
                        height: 30,
                        borderRadius: 999,
                        background: palette.olive,
                        boxShadow: `inset 0 0 0 1px ${palette.olive}`,
                        fontFamily: fonts.sans,
                        fontSize: 16,
                        fontWeight: 500,
                        lineHeight: '30px',
                        whiteSpace: 'nowrap',
                        color: palette.onOliveAlt,
                        cursor: 'help',
                      }}
                    >
                      기록
                    </button>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        aria-label={`${item.name} 장소 변경`}
                        disabled={actionsDisabled}
                        onClick={() => openWishlistMap('wishlist-edit', item.id)}
                        style={{ ...compactActionStyle, opacity: actionsDisabled ? 0.55 : 1 }}
                      >
                        {isUpdating ? '변경 중' : '변경'}
                      </button>
                      <button
                        type="button"
                        aria-label={`${item.name} 삭제`}
                        disabled={actionsDisabled}
                        onClick={() => requestDelete(item)}
                        style={{ ...compactActionStyle, opacity: actionsDisabled ? 0.55 : 1 }}
                      >
                        {isDeleting ? '삭제 중' : '삭제'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            aria-label={isCreating ? '추가 중' : '가고 싶은 곳 더하기'}
            disabled={Boolean(pendingAction)}
            onClick={() => openWishlistMap('wishlist-add')}
            style={{
              height: 54,
              borderRadius: 999,
              boxShadow: `inset 0 0 0 1px ${palette.olive}`,
              display: 'flex',
              flexDirection: 'row',
              gap: 10,
              padding: '12px 32px',
              justifyContent: 'center',
              alignItems: 'center',
              boxSizing: 'border-box',
              alignSelf: 'stretch',
              fontFamily: fonts.sans,
              fontSize: 16,
              fontWeight: 500,
              lineHeight: '30px',
              color: palette.olive,
              cursor: pendingAction ? 'default' : 'pointer',
              opacity: pendingAction ? 0.55 : 1,
            }}
          >
            <MaskIcon src={uiSvg.plusSketch} color={palette.olive} size={24} />
            {isCreating ? '추가 중…' : '가고 싶은 곳 더하기'}
          </button>
        </div>
      </div>
    </Screen>
  );
}
