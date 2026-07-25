/**
 * Figma 원본 SVG 에셋 — Vite가 각 import를 URL 문자열로 바꿔준다.
 *
 *   import { flowerSvg, svgSize } from '@assets/svg';
 *   <img src={flowerSvg.rose} {...svgSize.rose} alt="" />
 *
 * intrinsicSize는 SVG의 viewBox 실측값이다. 이 앱은 402×874 캔버스에
 * 절대 좌표로 배치하므로, 비율을 깨지 않으려면 이 값의 배수로 렌더할 것.
 */

import rose from './flowers/rose.svg';
import marigold from './flowers/marigold.svg';
import calla from './flowers/calla.svg';
import clover from './flowers/clover.svg';
import forgetmenot from './flowers/forgetmenot.svg';
import lilac from './flowers/lilac.svg';
import jasmine from './flowers/jasmine.svg';
import flowersBundle from './flowers/flowers.svg';

import letter from './onboarding/letter.svg';
import name from './onboarding/name.svg';
import note1 from './onboarding/note1.svg';
import note2 from './onboarding/note2.svg';
import note2b from './onboarding/note2-2.svg';
import roseHead from './onboarding/rose-head.svg';
import lineLong from './onboarding/line-long.svg';
import lineShort from './onboarding/line-short.svg';

import flowerBlank from './etc/flower-blank.svg';
import memoNote from './etc/memo-note.svg';
import pencil from './etc/pencil.svg';
import ratingFlower from './etc/rating-flower.svg';
import schedule from './etc/schedule.svg';
import scape from './etc/scape.svg';
import scheduleColor from './etc/schedule-color.svg';
import sticker from './etc/sticker.svg';

import camera from './ui/camera.svg';
import cancelCircle from './ui/cancelCircle.svg';
import cancel from './ui/cancel.svg';
import circle from './ui/circle.svg';
import expandDown from './ui/expandDown.svg';
import expandLeft from './ui/expandLeft.svg';
import expandRight from './ui/expandRight.svg';
import expandUp from './ui/expandUp.svg';
import heart from './ui/heart.svg';
import heartFilled from './ui/heartFilled.svg';
import homeSketch from './ui/homeSketch.svg';
import calendar from './ui/calendar.svg';
import crew from './ui/crew.svg';
import home from './ui/home.svg';
import log from './ui/log.svg';
import minus from './ui/minus.svg';
import myPage from './ui/myPage.svg';
import people from './ui/people.svg';
import plus from './ui/plus.svg';
import mapSketch from './ui/mapSketch.svg';
import plusSketch from './ui/plusSketch.svg';
import profile from './ui/profile.svg';
import arrowDown from './ui/arrowDown.svg';
import arrowLeft from './ui/arrowLeft.svg';
import arrowRight from './ui/arrowRight.svg';
import arrowUp from './ui/arrowUp.svg';
import search from './ui/search.svg';
import time from './ui/time.svg';

/** 꽃갈피 7종 — key는 fixtures.js의 FLOWERS key와 1:1로 맞춰져 있다 */
export const flowerSvg = { rose, marigold, calla, clover, forgetmenot, lilac, jasmine };

/** 꽃 여러 송이가 함께 그려진 묶음 일러스트 (도감/온보딩용, 꽃갈피 7종과 별개) */
export const flowersIllustSvg = flowersBundle;

export const onboardingSvg = {
  letter,
  name,
  note1,
  note2,
  note2b,
  roseHead,
  lineLong,
  lineShort,
};

/**
 * scheduleColor: 32×32 컬러 캘린더 (홈 "n월의 기록" 헤더)
 * scape: 92×92 풍경 일러스트 — 사진 업로드 전 썸네일 자리. 하늘색 라운드 사각
 *        배경(#C8E1F2, rx 10.857)이 SVG 안에 포함돼 있어 별도 배경/radius가 필요 없다.
 */
export const etcSvg = {
  flowerBlank,
  memoNote,
  pencil,
  ratingFlower,
  scape,
  schedule,
  scheduleColor,
  sticker,
};

/** 공통 24×24 UI 아이콘 */
export const uiSvg = {
  camera,
  cancelCircle,
  cancel,
  circle,
  expandDown,
  expandLeft,
  expandRight,
  expandUp,
  heart,
  heartFilled,
  homeSketch,
  calendar,
  crew,
  home,
  log,
  minus,
  myPage,
  people,
  plus,
  mapSketch,
  pencil,
  plusSketch,
  profile,
  arrowDown,
  arrowLeft,
  arrowRight,
  arrowUp,
  schedule,
  search,
  time,
};

/** viewBox 실측 크기 (px) */
export const svgSize = {
  rose: { width: 67, height: 91 },
  marigold: { width: 67, height: 91 },
  calla: { width: 67, height: 91 },
  clover: { width: 67, height: 91 },
  forgetmenot: { width: 67, height: 91 },
  lilac: { width: 67, height: 91 },
  jasmine: { width: 67, height: 91 },
  flowersIllust: { width: 59, height: 90 },

  letter: { width: 139, height: 105 },
  name: { width: 258, height: 172 },
  note1: { width: 325, height: 456 },
  note2: { width: 382, height: 279 },
  note2b: { width: 382, height: 312 },
  roseHead: { width: 90, height: 93 },
  lineLong: { width: 358, height: 12 },
  lineShort: { width: 51, height: 10 },

  flowerBlank: { width: 92, height: 124 },
  memoNote: { width: 277, height: 202 },
  pencil: { width: 24, height: 24 },
  ratingFlower: { width: 24, height: 24 },
  scape: { width: 92, height: 92 },
  schedule: { width: 24, height: 24 },
  scheduleColor: { width: 32, height: 32 },
  sticker: { width: 65, height: 30 },

  camera: { width: 24, height: 24 },
  cancelCircle: { width: 24, height: 24 },
  cancel: { width: 24, height: 24 },
  circle: { width: 24, height: 24 },
  expandDown: { width: 24, height: 24 },
  expandLeft: { width: 24, height: 24 },
  expandRight: { width: 24, height: 24 },
  expandUp: { width: 24, height: 24 },
  heart: { width: 24, height: 24 },
  heartFilled: { width: 24, height: 24 },
  homeSketch: { width: 24, height: 24 },
  calendar: { width: 24, height: 24 },
  crew: { width: 24, height: 24 },
  home: { width: 24, height: 24 },
  log: { width: 24, height: 24 },
  minus: { width: 24, height: 24 },
  myPage: { width: 24, height: 24 },
  people: { width: 24, height: 24 },
  plus: { width: 24, height: 24 },
  mapSketch: { width: 24, height: 24 },
  plusSketch: { width: 24, height: 24 },
  profile: { width: 24, height: 24 },
  arrowDown: { width: 24, height: 24 },
  arrowLeft: { width: 24, height: 24 },
  arrowRight: { width: 24, height: 24 },
  arrowUp: { width: 24, height: 24 },
  search: { width: 24, height: 24 },
  time: { width: 24, height: 24 },
};

/** 원본 높이를 유지하며 폭을 비율에 맞게 계산 */
export function scaleToHeight(key, height) {
  const s = svgSize[key];
  if (!s) throw new Error(`알 수 없는 SVG key: ${key}`);
  return { width: Math.round((s.width / s.height) * height), height };
}
