import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/data/errors';
import { useApp } from '@/data/store';
import * as api from '@/data/api';
import Wishlist from './Wishlist';

vi.mock('@/data/store', () => ({ useApp: vi.fn() }));
vi.mock('@/data/api', () => ({ getWishlist: vi.fn() }));

const PLACE = Object.freeze({
  id: '28720295',
  name: '블루보틀 성수 카페',
  category: '음식점 > 카페',
  address: '서울 성동구 성수동1가 656-439',
  roadAddress: '서울 성동구 아차산로 7',
  phone: '02-6212-6998',
  url: 'https://place.map.kakao.com/28720295',
  lat: 37.5446137523921,
  lng: 127.055978290073,
  provider: 'kakao',
});

const ITEM = Object.freeze({
  id: 'wishlist-partner-1',
  provider: 'kakao',
  providerId: PLACE.id,
  name: '서울숲 작은 카페',
  category: '카페',
  address: '서울 성동구 서울숲길 1',
  roadAddress: '서울 성동구 왕십리로 1',
  url: 'https://place.map.kakao.com/second-place',
  lat: 37.546,
  lng: 127.049,
  pickedBy: '민수',
  pickedByUserId: 'partner-private-user-id',
  coupleId: 'private-couple-id',
});

let currentLocation = null;
let app;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function WishlistRoute() {
  currentLocation = useLocation();
  return <Wishlist />;
}

function Destination() {
  currentLocation = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      지도 화면
      <button type="button" onClick={() => navigate(-1)}>지도에서 뒤로</button>
    </div>
  );
}

function renderWishlist({
  state,
  appOverride,
  historyBase = false,
  strict = false,
} = {}) {
  useApp.mockReturnValue({ ...app, ...appOverride });
  const wishlistEntry = state
    ? { pathname: '/mypage/wishlist', state }
    : { pathname: '/mypage/wishlist' };
  const initialEntries = historyBase ? ['/mypage', wishlistEntry] : [wishlistEntry];
  const content = (
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
      <Routes>
        <Route path="/mypage/wishlist" element={<WishlistRoute />} />
        <Route path="/map" element={<Destination />} />
        <Route path="/mypage" element={<div>마이페이지 화면</div>} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{content}</StrictMode> : content);
}

beforeEach(() => {
  currentLocation = null;
  vi.resetAllMocks();
  api.getWishlist.mockResolvedValue([]);
  vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
  app = {
    wishlist: [ITEM],
    wishlistStatus: 'ready',
    wishlistError: null,
    retryWishlist: vi.fn().mockResolvedValue([ITEM]),
    createWishlistPlace: vi.fn().mockResolvedValue({ id: 'wishlist-new', ...PLACE }),
    updateWishlistPlace: vi.fn().mockResolvedValue({ ...ITEM, ...PLACE }),
    deleteWishlistPlace: vi.fn().mockResolvedValue({ id: ITEM.id }),
  };
});

describe('Wishlist shared data states', () => {
  it('useApp의 첫 조회 로딩 상태를 표시하고 화면에서 API를 직접 호출하지 않는다', () => {
    renderWishlist({ appOverride: { wishlist: [], wishlistStatus: 'loading' } });

    expect(screen.getByRole('status')).toHaveTextContent('가고 싶은 곳을 불러오고 있어요');
    expect(api.getWishlist).not.toHaveBeenCalled();
  });

  it('준비된 목록이 비어 있으면 안전한 빈 화면과 추가 동작을 표시한다', () => {
    renderWishlist({ appOverride: { wishlist: [] } });

    expect(screen.getByText('아직 가고 싶은 곳이 없어요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '가고 싶은 곳 더하기' })).toBeEnabled();
  });

  it('조회 오류 원문을 숨기고 명시적인 목록 재시도를 제공한다', async () => {
    const user = userEvent.setup();
    const raw = 'https://db.invalid?apikey=never-show-this-key';
    renderWishlist({
      appOverride: {
        wishlist: [],
        wishlistStatus: 'error',
        wishlistError: new AppError(ERROR_CODES.network, { message: raw }),
      },
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('가고 싶은 곳을 불러오지 못했어요');
    expect(alert).not.toHaveTextContent('never-show-this-key');

    await user.click(screen.getByRole('button', { name: '목록 다시 시도' }));
    expect(app.retryWishlist).toHaveBeenCalledTimes(1);
  });

  it('실제 공유 장소와 작성자 이름을 표시한다', () => {
    renderWishlist();

    expect(screen.getAllByText(ITEM.name).length).toBeGreaterThan(0);
    expect(screen.getByText(ITEM.category)).toBeInTheDocument();
    expect(screen.getByText(`${ITEM.pickedBy} Pick!`)).toBeInTheDocument();
  });
});

describe('Wishlist route intents and non-visit behavior', () => {
  it('기록 모양 버튼은 방문을 만들거나 이동하지 않고 홈 + 시작점을 설명한다', async () => {
    const user = userEvent.setup();
    renderWishlist();

    await user.click(screen.getByRole('button', { name: `${ITEM.name} 기록 안내` }));

    expect(screen.getByRole('status', { name: '기록 안내' })).toHaveTextContent(
      '방문 기록은 홈 화면 아래의 + 버튼에서 시작해요',
    );
    expect(currentLocation.pathname).toBe('/mypage/wishlist');
    expect(app.createWishlistPlace).not.toHaveBeenCalled();
    expect(app.updateWishlistPlace).not.toHaveBeenCalled();
    expect(app.deleteWishlistPlace).not.toHaveBeenCalled();
  });

  it('추가는 현재 화면을 wishlist-add 지도 intent로 교체해 stale history를 남기지 않는다', async () => {
    const user = userEvent.setup();
    renderWishlist({ historyBase: true });

    await user.click(screen.getByRole('button', { name: '가고 싶은 곳 더하기' }));

    expect(await screen.findByText('지도 화면')).toBeInTheDocument();
    expect(currentLocation.pathname).toBe('/map');
    expect(currentLocation.state).toEqual({ intent: 'wishlist-add' });

    await user.click(screen.getByRole('button', { name: '지도에서 뒤로' }));
    expect(await screen.findByText('마이페이지 화면')).toBeInTheDocument();
  });

  it('상대가 추가한 공유 항목도 변경할 수 있고 private 값은 지도 intent로 넘기지 않는다', async () => {
    const user = userEvent.setup();
    renderWishlist();

    await user.click(screen.getByRole('button', { name: `${ITEM.name} 장소 변경` }));

    expect(await screen.findByText('지도 화면')).toBeInTheDocument();
    expect(currentLocation.state).toEqual({
      intent: 'wishlist-edit',
      wishlistId: ITEM.id,
    });
    expect(JSON.stringify(currentLocation.state)).not.toContain('private');
  });
});

describe('Wishlist CRUD actions', () => {
  it('반환된 add intent를 StrictMode에서도 한 번만 처리하고 불변 장소만 전달한다', async () => {
    const pending = deferred();
    app.createWishlistPlace.mockReturnValue(pending.promise);
    renderWishlist({
      state: {
        intent: 'wishlist-add',
        place: Object.freeze({
          ...PLACE,
          couple_id: 'private-couple-id',
          created_by: 'private-user-id',
          partnerText: 'private-partner-value',
        }),
      },
      appOverride: { wishlist: [] },
      strict: true,
    });

    await waitFor(() => expect(app.createWishlistPlace).toHaveBeenCalledTimes(1));
    const input = app.createWishlistPlace.mock.calls[0][0];
    expect(input).toEqual(PLACE);
    expect(Object.isFrozen(input)).toBe(true);
    expect(JSON.stringify(input)).not.toContain('private');
    expect(currentLocation.state).toBeNull();
    expect(screen.getByRole('button', { name: '추가 중' })).toBeDisabled();

    await act(async () => pending.resolve({ id: 'wishlist-new', ...PLACE }));
  });

  it('추가 실패 시 선택한 장소를 보존하고 그 추가만 재시도한다', async () => {
    const user = userEvent.setup();
    app.createWishlistPlace
      .mockRejectedValueOnce(new AppError(ERROR_CODES.network, { message: 'secret-token' }))
      .mockResolvedValueOnce({ id: 'wishlist-new', ...PLACE });
    renderWishlist({ state: { intent: 'wishlist-add', place: PLACE } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('장소를 추가하지 못했어요');
    expect(alert).toHaveTextContent(PLACE.name);
    expect(alert).not.toHaveTextContent('secret-token');

    await user.click(screen.getByRole('button', { name: '추가 다시 시도' }));

    await waitFor(() => expect(app.createWishlistPlace).toHaveBeenCalledTimes(2));
    expect(app.createWishlistPlace.mock.calls[1][0]).toBe(
      app.createWishlistPlace.mock.calls[0][0],
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('추가가 성공한 뒤 목록 조회만 실패하면 stale 안내만 보여주고 추가를 다시 쓰지 않는다', async () => {
    const user = userEvent.setup();
    // 고친 스토어의 관측 상태: 쓰기는 resolve하고, 뒤이은 조회 실패는 wishlistStatus
    // 오류(직전 목록 유지)로만 남는다. 여기서 추가 재시도를 노출하면 멱등키가 없어
    // 같은 행이 한 번 더 들어간다.
    renderWishlist({
      state: { intent: 'wishlist-add', place: PLACE },
      appOverride: {
        wishlistStatus: 'error',
        wishlistError: new AppError(ERROR_CODES.network),
      },
    });

    await waitFor(() => expect(app.createWishlistPlace).toHaveBeenCalledTimes(1));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('최신 목록을 확인하지 못했어요');
    expect(alert).not.toHaveTextContent('장소를 추가하지 못했어요');
    expect(screen.queryByRole('button', { name: '추가 다시 시도' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '목록 다시 시도' }));

    expect(app.retryWishlist).toHaveBeenCalledTimes(1);
    expect(app.createWishlistPlace).toHaveBeenCalledTimes(1);
  });

  it('변경 실패 시 공유 목록과 새 장소를 보존하고 그 변경만 재시도한다', async () => {
    const user = userEvent.setup();
    const firstUpdate = deferred();
    app.updateWishlistPlace
      .mockReturnValueOnce(firstUpdate.promise)
      .mockResolvedValueOnce({ ...ITEM, ...PLACE });
    renderWishlist({
      state: {
        intent: 'wishlist-edit',
        wishlistId: ITEM.id,
        place: PLACE,
      },
    });

    const editButton = screen.getByRole('button', { name: `${ITEM.name} 장소 변경` });
    await waitFor(() => expect(editButton).toBeDisabled());
    expect(editButton).toHaveTextContent('변경 중');
    await act(async () => firstUpdate.reject(
      new AppError(ERROR_CODES.network, { message: 'secret-token' }),
    ));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('장소를 변경하지 못했어요');
    expect(alert).toHaveTextContent(PLACE.name);
    expect(screen.getByText(ITEM.name)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '변경 다시 시도' }));

    await waitFor(() => expect(app.updateWishlistPlace).toHaveBeenCalledTimes(2));
    expect(app.updateWishlistPlace).toHaveBeenNthCalledWith(1, ITEM.id, expect.any(Object));
    expect(app.updateWishlistPlace.mock.calls[1][1]).toBe(
      app.updateWishlistPlace.mock.calls[0][1],
    );
  });

  it('삭제는 명시적 확인 뒤에만 실행하고 실패하면 항목을 유지해 그 삭제만 재시도한다', async () => {
    const user = userEvent.setup();
    const firstDelete = deferred();
    globalThis.confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);
    app.deleteWishlistPlace
      .mockReturnValueOnce(firstDelete.promise)
      .mockResolvedValueOnce({ id: ITEM.id });
    renderWishlist();
    const deleteButton = screen.getByRole('button', { name: `${ITEM.name} 삭제` });

    await user.click(deleteButton);
    expect(app.deleteWishlistPlace).not.toHaveBeenCalled();

    await user.click(deleteButton);
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveTextContent('삭제 중');
    await act(async () => firstDelete.reject(
      new AppError(ERROR_CODES.network, { message: 'secret-token' }),
    ));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('장소를 삭제하지 못했어요');
    expect(screen.getAllByText(ITEM.name).length).toBeGreaterThan(0);
    expect(alert).not.toHaveTextContent('secret-token');

    await user.click(screen.getByRole('button', { name: '삭제 다시 시도' }));
    await waitFor(() => expect(app.deleteWishlistPlace).toHaveBeenCalledTimes(2));
    expect(app.deleteWishlistPlace).toHaveBeenNthCalledWith(1, ITEM.id);
    expect(app.deleteWishlistPlace).toHaveBeenNthCalledWith(2, ITEM.id);
    expect(globalThis.confirm).toHaveBeenCalledTimes(2);
  });
});
