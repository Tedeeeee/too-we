import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PlaceDetail from './PlaceDetail';

const COUPLE = {
  me: { name: '지은', initial: '지', color: '#E4D2BA' },
  partner: { name: '태식', initial: '태', color: '#F3BCBC' },
};

const RECORD = {
  id: 'visit-1',
  placeName: '성수 카페',
  date: '2026-08-03T09:25:00.000Z',
  rating: 5,
  flower: 'rose',
  tags: ['# 첫 번째', '# 두 번째'],
  photos: [
    { id: 'photo-2', order: 2, url: 'https://signed.invalid/two' },
    { id: 'photo-1', order: 1, url: 'https://signed.invalid/one' },
  ],
  entries: [
    { memberId: 'me', text: '내 한 줄', rating: 5, readOnly: false },
    { memberId: 'partner', text: '짝궁 한 줄', rating: 2, readOnly: true },
  ],
};

const renderDetail = (props = {}) => render(
  <PlaceDetail
    record={RECORD}
    couple={COUPLE}
    photoIndex={0}
    onNextPhoto={vi.fn()}
    onRetryPhotos={vi.fn()}
    {...props}
  />,
);

describe('PlaceDetail real visit content', () => {
  it('사진 order와 private signed URL을 사용하고 공동 날짜·시간·태그·꽃갈피를 보여준다', () => {
    renderDetail();

    expect(screen.getByRole('img', { name: '성수 카페 사진 1/2' })).toHaveAttribute(
      'src',
      'https://signed.invalid/one',
    );
    expect(screen.getByText(/8월 3일/)).toHaveTextContent(/PM 6:25/);
    expect(screen.getByText('# 첫 번째')).toBeInTheDocument();
    expect(screen.getByText('# 두 번째')).toBeInTheDocument();
    expect(screen.getByText('장미 꽃갈피')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('storage_path');
  });

  it('두 사람의 한 줄과 별점을 읽기 전용으로 렌더한다', () => {
    renderDetail();

    const mine = screen.getByLabelText('지은의 기록 (읽기 전용)');
    const partner = screen.getByLabelText('태식의 기록 (읽기 전용)');
    expect(mine).toHaveTextContent('내 한 줄');
    expect(mine).toHaveTextContent('5점');
    expect(partner).toHaveTextContent('짝궁 한 줄');
    expect(partner).toHaveTextContent('2점');
    expect(screen.queryByDisplayValue('짝궁 한 줄')).not.toBeInTheDocument();
  });

  it('사진이 없으면 명확한 empty 상태를 보여준다', () => {
    renderDetail({ record: { ...RECORD, photos: [] }, onNextPhoto: undefined });

    expect(screen.getByText('아직 사진이 없어요')).toBeInTheDocument();
    expect(screen.queryByLabelText('다음 사진')).not.toBeInTheDocument();
  });

  it('image 오류를 fallback으로 바꾸고 해당 사진만 다시 불러오게 한다', async () => {
    const user = userEvent.setup();
    const onRetryPhotos = vi.fn().mockResolvedValue(undefined);
    renderDetail({ onRetryPhotos });

    fireEvent.error(screen.getByRole('img', { name: '성수 카페 사진 1/2' }));
    expect(screen.getByRole('alert')).toHaveTextContent('사진을 불러오지 못했어요');

    await user.click(screen.getByRole('button', { name: '이 사진 다시 불러오기' }));

    expect(onRetryPhotos).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('img', { name: '성수 카페 사진 1/2' })).toBeInTheDocument();
  });
});
