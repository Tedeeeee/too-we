/**
 * 화면별 SVG 연결 계약 검증.
 *
 * 원본 SVG가 등록돼 있어도 화면이 구형 JSX 아이콘을 계속 사용하는 상태를 방지한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const onboardingNamePath = path.join(ROOT, 'src/screens/OnboardingName.jsx');
const onboardingName = fs.readFileSync(onboardingNamePath, 'utf8');
const onboardingNameImage = onboardingName.match(/<img[\s\S]*?\/>/)?.[0] ?? '';
const onboardingNameLine = onboardingName.match(/<HandDrawnLine[\s\S]*?\/>/)?.[0] ?? '';
const onboardingCodePath = path.join(ROOT, 'src/screens/OnboardingCode.jsx');
const onboardingCode = fs.readFileSync(onboardingCodePath, 'utf8');
const onboardingCodeImage = onboardingCode.match(/<img[\s\S]*?\/>/)?.[0] ?? '';
const onboardingCodeLine = onboardingCode.match(/<HandDrawnLine[\s\S]*?\/>/)?.[0] ?? '';
const onboardingSharePath = path.join(ROOT, 'src/screens/OnboardingShare.jsx');
const onboardingShare = fs.readFileSync(onboardingSharePath, 'utf8');
const onboardingShareNote = onboardingShare.match(
  /<img[\s\S]*?src=\{onboardingSvg\.note1\}[\s\S]*?\/>/,
)?.[0] ?? '';
const homePath = path.join(ROOT, 'src/screens/Home.jsx');
const home = fs.readFileSync(homePath, 'utf8');
const homeCta = home.match(/<button\s+data-home-cta[\s\S]*?<\/button>/)?.[0] ?? '';
const homeSticker = home.match(/<div\s+data-record-sticker[\s\S]*?<\/div>/)?.[0] ?? '';
const stickerPath = path.join(ROOT, 'design-assets/svg/etc/sticker.svg');
const sticker = fs.readFileSync(stickerPath, 'utf8');
const recordCardPath = path.join(ROOT, 'src/components/RecordCard.jsx');
const recordCard = fs.readFileSync(recordCardPath, 'utf8');
const bottomNavPath = path.join(ROOT, 'src/components/BottomNav.jsx');
const bottomNav = fs.readFileSync(bottomNavPath, 'utf8');
const svgRegistryPath = path.join(ROOT, 'design-assets/svg/index.js');
const svgRegistry = fs.readFileSync(svgRegistryPath, 'utf8');
const handDrawnLinePath = path.join(ROOT, 'src/components/HandDrawnLine.jsx');
const handDrawnLine = fs.existsSync(handDrawnLinePath)
  ? fs.readFileSync(handDrawnLinePath, 'utf8')
  : '';
const mapSelectPath = path.join(ROOT, 'src/screens/MapSelect.jsx');
const mapSelect = fs.readFileSync(mapSelectPath, 'utf8');
const placeDetailPath = path.join(ROOT, 'src/components/PlaceDetail.jsx');
const placeDetail = fs.readFileSync(placeDetailPath, 'utf8');
const flowerRatingPath = path.join(ROOT, 'src/components/FlowerRating.jsx');
const flowerRating = fs.readFileSync(flowerRatingPath, 'utf8');
const recordEditPath = path.join(ROOT, 'src/screens/RecordEdit.jsx');
const recordEdit = fs.readFileSync(recordEditPath, 'utf8');
const flowerPickSheetPath = path.join(ROOT, 'src/components/FlowerPickSheet.jsx');
const flowerPickSheet = fs.readFileSync(flowerPickSheetPath, 'utf8');
const bookmarkPickPath = path.join(ROOT, 'src/screens/BookmarkPick.jsx');
const bookmarkPick = fs.readFileSync(bookmarkPickPath, 'utf8');
const myPagePath = path.join(ROOT, 'src/screens/MyPage.jsx');
const myPage = fs.readFileSync(myPagePath, 'utf8');
const myPageDisconnect = myPage.match(/<button\s+data-disconnect[\s\S]*?<\/button>/)?.[0] ?? '';

const checks = [
  {
    name: 'OnboardingName: onboardingSvg import',
    pass: /import\s+\{\s*onboardingSvg\s*\}\s+from\s+['"]@assets\/svg['"]/.test(onboardingName),
  },
  {
    name: 'OnboardingName: name.svg 연결',
    pass: /src=\{onboardingSvg\.name\}/.test(onboardingNameImage),
  },
  {
    name: 'OnboardingName: 원본 너비 258',
    pass: /width=\{258\}/.test(onboardingNameImage),
  },
  {
    name: 'OnboardingName: 원본 높이 172',
    pass: /height=\{172\}/.test(onboardingNameImage),
  },
  {
    name: 'OnboardingName: 구형 WritingIllust 제거',
    pass: !/WritingIllust/.test(onboardingName),
  },
  {
    name: 'OnboardingCode: onboardingSvg import',
    pass: /import\s+\{\s*onboardingSvg\s*\}\s+from\s+['"]@assets\/svg['"]/.test(onboardingCode),
  },
  {
    name: 'OnboardingCode: letter.svg 연결',
    pass: /src=\{onboardingSvg\.letter\}/.test(onboardingCodeImage),
  },
  {
    name: 'OnboardingCode: 원본 너비 139',
    pass: /width=\{139\}/.test(onboardingCodeImage),
  },
  {
    name: 'OnboardingCode: 원본 높이 105',
    pass: /height=\{105\}/.test(onboardingCodeImage),
  },
  {
    name: 'OnboardingCode: 구형 EnvelopeIllust 제거',
    pass: !/EnvelopeIllust/.test(onboardingCode),
  },
  {
    name: 'OnboardingShare: onboardingSvg import',
    pass: /import\s+\{[^}]*\bonboardingSvg\b[^}]*\}\s+from\s+['"]@assets\/svg['"]/.test(onboardingShare),
  },
  {
    name: 'OnboardingShare: note1.svg background',
    pass: /src=\{onboardingSvg\.note1\}/.test(onboardingShareNote),
  },
  {
    name: 'OnboardingShare: note1 intrinsic size',
    pass: /\{\.\.\.svgSize\.note1\}/.test(onboardingShareNote),
  },
  {
    name: 'OnboardingShare: legacy PunchHoles removed',
    pass: !/\bPunchHoles\b/.test(onboardingShare),
  },
  {
    name: 'Home: onboardingSvg and etcSvg imports',
    pass: /import\s+\{[^}]*\bonboardingSvg\b[^}]*\betcSvg\b[^}]*\}\s+from\s+['"]@assets\/svg['"]/.test(home)
      || /import\s+\{[^}]*\betcSvg\b[^}]*\bonboardingSvg\b[^}]*\}\s+from\s+['"]@assets\/svg['"]/.test(home),
  },
  {
    name: 'Home: note2-2.svg card backgrounds',
    pass: (home.match(/src=\{onboardingSvg\.note2b\}/g) ?? []).length >= 2,
  },
  {
    name: 'Home: note2-2 backgrounds fill card bounds',
    pass: (home.match(/objectFit:\s*['"]fill['"]/g) ?? []).length >= 2,
  },
  {
    name: 'Home: note2-2 backgrounds fill refreshed paper bounds',
    pass: (home.match(/width=\{382\}/g) ?? []).length >= 2
      && (home.match(/height=\{242\}/g) ?? []).length >= 2
      && (home.match(/left:\s*-17/g) ?? []).length >= 2
      && (home.match(/top:\s*-8/g) ?? []).length >= 2
      && (home.match(/transform:\s*['"]scaleX\(1\.22\)['"]/g) ?? []).length >= 2
      && !/scaleX\(1\.15\)/.test(home),
  },
  {
    name: 'Home: sticker.svg',
    pass: /src=\{etcSvg\.sticker\}/.test(home),
  },
  {
    name: 'Home: sticker label follows each record date',
    pass: /import\s+\{[^}]*\bformatStickerDate\b[^}]*\}\s+from\s+['"]@\/data\/format['"]/.test(home)
      && /data-record-sticker/.test(homeSticker)
      && /\{formatStickerDate\(rec\.date\)\}/.test(homeSticker),
  },
  {
    name: 'Home: flower-blank.svg',
    pass: /src=\{etcSvg\.flowerBlank\}/.test(home),
  },
  {
    name: 'Home: pencil.svg',
    pass: /src=\{etcSvg\.pencil\}/.test(home),
  },
  {
    name: 'Home: legacy card drawings removed',
    pass: !/\bPunchHoles\b|\bBalloonSketch\b/.test(home),
  },
  {
    name: 'Home: carousel exposes the next card',
    pass: /data-pending-carousel/.test(home)
      && /top:\s*80/.test(home)
      && /height:\s*228/.test(home)
      && /padding:\s*['"]0 18px 0 24px['"]/.test(home)
      && /scrollPaddingLeft:\s*24/.test(home)
      && /gap:\s*12/.test(home)
      && /scrollLeft\s*\/\s*360/.test(home),
  },
  {
    name: 'Home: refreshed pending card size',
    pass: /data-pending-card/.test(home)
      && (home.match(/width:\s*348/g) ?? []).length >= 2
      && (home.match(/height:\s*228/g) ?? []).length >= 2,
  },
  {
    name: 'Home: pending-card content follows the refreshed reference alignment',
    pass: /data-record-sticker[\s\S]*?left:\s*44[\s\S]*?top:\s*26/.test(home)
      && (home.match(/left:\s*43,\s*top:\s*(?:66|100)/g) ?? []).length >= 2
      && /src=\{etcSvg\.flowerBlank\}[\s\S]*?left:\s*232,\s*top:\s*16/.test(home),
  },
  {
    name: 'Home: header subtitle removed',
    pass: /data-home-logo/.test(home)
      && /data-home-title/.test(home)
      && /data-home-logo[\s\S]*?left:\s*34[\s\S]*?top:\s*9/.test(home)
      && /data-home-title[\s\S]*?left:\s*78[\s\S]*?top:\s*33/.test(home)
      && !/우리가 머문 자리에 꽃갈피를 남겨주세요/.test(home),
  },
  {
    name: 'Home: upper sections share the 16px breathing-room offset',
    pass: /left:\s*336,\s*top:\s*26/.test(home)
      && /left:\s*354,\s*top:\s*28/.test(home)
      && /data-home-carousel-dots[\s\S]*?top:\s*320/.test(home)
      && /data-home-month-list[\s\S]*?top:\s*336[\s\S]*?height:\s*538/.test(home),
  },
  {
    name: 'Home: refreshed pending line CTA',
    pass: /data-home-cta/.test(homeCta)
      && /한 줄을 남겨주세요/.test(homeCta)
      && /fontFamily:\s*fonts\.hand/.test(homeCta)
      && /left:\s*41/.test(homeCta)
      && /top:\s*152/.test(homeCta)
      && /width:\s*280/.test(homeCta)
      && /height:\s*36/.test(homeCta)
      && /width=\{22\}/.test(homeCta)
      && /height=\{22\}/.test(homeCta)
      && !/꽃갈피를 남겨주세요/.test(homeCta),
  },
  {
    name: 'Home: redundant waiting caption removed',
    pass: !/짝궁이 당신의 답을 기다리고 있어요!/.test(home),
  },
  {
    name: 'Home: sticker uses refreshed soft pink',
    pass: /fill="#F7CEC6"/.test(sticker)
      && !/fill="#DF3633"/.test(sticker),
  },
  {
    name: 'Home: profile.svg masks both badges',
    pass: /\buiSvg\b/.test(home)
      && (home.match(/maskImage:/g) ?? []).length >= 2
      && (home.match(/url\("\$\{uiSvg\.profile\}"\)/g) ?? []).length >= 2
      && (home.match(/clipPath:\s*['"]circle\(50%\)['"]/g) ?? []).length >= 2,
  },
  {
    name: 'Home: profile initials remain dynamic',
    pass: /\{couple\.me\.initial\}/.test(home)
      && /\{couple\.partner\.initial\}/.test(home),
  },
  {
    name: 'Home: schedule-color.svg month header',
    pass: /src=\{etcSvg\.scheduleColor\}/.test(home),
  },
  {
    name: 'RecordCard: flower SVG follows record data',
    pass: /\bflowerSvg\b/.test(recordCard)
      && /src=\{flowerSvg\[record\.flower\]\}/.test(recordCard),
  },
  {
    name: 'RecordCard: legacy PressedFlower removed',
    pass: !/\bPressedFlower\b/.test(recordCard),
  },
  {
    name: 'RecordCard: scape.svg photo placeholder',
    pass: /src=\{etcSvg\.scape\}/.test(recordCard),
  },
  {
    name: 'BottomNav: sketch SVG icons',
    pass: /\buiSvg\.homeSketch\b/.test(bottomNav)
      && /\buiSvg\.mapSketch\b/.test(bottomNav),
  },
  {
    name: 'BottomNav: legacy glyph icons removed',
    pass: !/[⌂♧]/.test(bottomNav),
  },
  {
    name: 'SVG registry: onboarding hand-drawn lines',
    pass: /lineLong/.test(svgRegistry)
      && /lineShort/.test(svgRegistry)
      && /lineLong:\s*\{\s*width:\s*358,\s*height:\s*12\s*\}/.test(svgRegistry)
      && /lineShort:\s*\{\s*width:\s*51,\s*height:\s*10\s*\}/.test(svgRegistry),
  },
  {
    name: 'HandDrawnLine: registered SVG masks',
    pass: /onboardingSvg\.lineLong/.test(handDrawnLine)
      && /onboardingSvg\.lineShort/.test(handDrawnLine)
      && /WebkitMaskImage/.test(handDrawnLine)
      && /maskImage/.test(handDrawnLine),
  },
  {
    name: 'OnboardingName: natural hand-drawn divider',
    pass: /\bHandDrawnLine\b/.test(onboardingName)
      && !/rotate\(-0\.3deg\)/.test(onboardingName),
  },
  {
    name: 'OnboardingCode: natural hand-drawn segments',
    pass: /\bHandDrawnLine\b/.test(onboardingCode)
      && !/\bSEG_ROTS\b/.test(onboardingCode),
  },
  {
    name: 'OnboardingShare: natural hand-drawn divider',
    pass: /\bHandDrawnLine\b/.test(onboardingShare)
      && !/borderTop:\s*`1\.5px dashed/.test(onboardingShare),
  },
  {
    name: 'OnboardingCode: each digit owns one underline cell',
    pass: /data-code-cell=\{i\}/.test(onboardingCode)
      && /\{code\[i\]\s*\?\?\s*['"]{2}\}/.test(onboardingCode)
      && !/letterSpacing:\s*22/.test(onboardingCode)
      && /top:\s*73/.test(onboardingCodeLine),
  },
  {
    name: 'OnboardingName: line and counter moved up together',
    pass: /top:\s*465/.test(onboardingNameLine)
      && /top:\s*486,[\s\S]{0,300}\{name\.length\}\/12/.test(onboardingName),
  },
  {
    name: 'MapSelect: time.svg memo chip icon',
    pass: /src=\{uiSvg\.time\}/.test(mapSelect)
      && !/◷/.test(mapSelect),
  },
  {
    name: 'MapSelect: hand-drawn sheet dividers',
    pass: /\bHandDrawnLine\b/.test(mapSelect)
      && !/height:\s*1,\s*background:\s*palette\.beige/.test(mapSelect),
  },
  {
    name: 'PlaceDetail: registered SVG navigation arrows',
    pass: /\buiSvg\.arrowLeft\b/.test(placeDetail)
      && /\buiSvg\.arrowRight\b/.test(placeDetail),
  },
  {
    name: 'PlaceDetail: registered pencil SVG',
    pass: /\betcSvg\.pencil\b/.test(placeDetail),
  },
  {
    name: 'PlaceDetail: flower bookmark follows record data',
    pass: /\bflowerSvg\b/.test(placeDetail)
      && /src=\{flowerSvg\[record\.flower\]\}/.test(placeDetail)
      && /src=\{etcSvg\.flowerBlank\}/.test(placeDetail),
  },
  {
    name: 'PlaceDetail: legacy pressed flower removed',
    pass: !/\bPressedFlower\b/.test(placeDetail),
  },
  {
    name: 'FlowerRating: registered rating flower SVG mask',
    pass: /\betcSvg\.ratingFlower\b/.test(flowerRating)
      && /\bMaskIcon\b/.test(flowerRating),
  },
  {
    name: 'SVG registry: rating flower asset',
    pass: /ratingFlower/.test(svgRegistry)
      && /ratingFlower:\s*\{\s*width:\s*24,\s*height:\s*24\s*\}/.test(svgRegistry),
  },
  {
    name: 'PlaceDetail: memo-note SVG card background',
    pass: /src=\{etcSvg\.memoNote\}/.test(placeDetail)
      && !/\bPunchHoles\b/.test(placeDetail),
  },
  {
    name: 'PlaceDetail: profile SVG masks lower avatars',
    pass: /src=\{uiSvg\.profile\}/.test(placeDetail)
      && /\{member\.initial\}/.test(placeDetail)
      && (placeDetail.match(/\{avatar\(/g) ?? []).length >= 2,
  },
  {
    name: 'PlaceDetail: sketch SVG tag add icon',
    pass: /src=\{uiSvg\.plusSketch\}/.test(placeDetail)
      && !/>＋</.test(placeDetail),
  },
  {
    name: 'SVG registry: memo-note asset',
    pass: /memoNote/.test(svgRegistry)
      && /memoNote:\s*\{\s*width:\s*277,\s*height:\s*202\s*\}/.test(svgRegistry),
  },
  {
    name: 'RecordEdit: schedule.svg date chip icon',
    pass: /src=\{uiSvg\.schedule\}/.test(recordEdit)
      && !/src=\{uiSvg\.calendar\}/.test(recordEdit),
  },
  {
    name: 'FlowerPickSheet: original flower SVGs',
    pass: /src=\{flowerSvg\[f\.key\]\}/.test(flowerPickSheet)
      && !/etcSvg\.ratingFlower/.test(flowerPickSheet),
  },
  {
    name: 'FlowerPickSheet: selected flower toggles to null',
    pass: /onSelect\(active\s*\?\s*null\s*:\s*f\.key\)/.test(flowerPickSheet),
  },
  {
    name: 'BookmarkPick: derives initial selection from current record',
    pass: /\buseRecord\(recordId\)/.test(bookmarkPick)
      && /\bFLOWERS\.some\(/.test(bookmarkPick)
      && /useState\(\(\)\s*=>/.test(bookmarkPick),
  },
  {
    name: 'BookmarkPick: null selection can be confirmed',
    pass: /if\s*\(saving\)\s*return/.test(bookmarkPick)
      && !/if\s*\(!selected\s*\|\|\s*saving\)/.test(bookmarkPick)
      && /setRecordFlower\(recordId,\s*selected\)/.test(bookmarkPick),
  },
  {
    name: 'FlowerPickSheet: null selection keeps confirm enabled',
    pass: /disabled=\{saving\}/.test(flowerPickSheet)
      && !/background:\s*selected\s*\?/.test(flowerPickSheet),
  },
  {
    name: 'BookmarkPick: save failure preserves selection for retry',
    pass: /\bcatch\s*\(/.test(bookmarkPick)
      && /\bfinally\s*\{/.test(bookmarkPick)
      && /setError\(/.test(bookmarkPick)
      && /error=\{error\}/.test(bookmarkPick),
  },
  {
    name: 'MyPage: backgroundless filled heart SVG',
    pass: /src=\{uiSvg\.heartFilled\}/.test(myPage)
      && !/src=\{uiSvg\.heart\}/.test(myPage)
      && /heartFilled/.test(svgRegistry)
      && /heartFilled:\s*\{\s*width:\s*24,\s*height:\s*24\s*\}/.test(svgRegistry),
  },
  {
    name: 'MyPage: two blank profile blobs',
    pass: /data-profile-blob=\{side\}/.test(myPage)
      && /profileBlob\(['"]left['"]\)/.test(myPage)
      && /profileBlob\(['"]right['"]\)/.test(myPage)
      && /width:\s*96/.test(myPage)
      && /height:\s*96/.test(myPage),
  },
  {
    name: 'MyPage: D-day value uses olive emphasis',
    pass: /data-dday/.test(myPage)
      && /color:\s*palette\.olive/.test(myPage),
  },
  {
    name: 'MyPage: settings rows span reference width',
    pass: /data-setting-row/.test(myPage)
      && /left:\s*2/.test(myPage)
      && /width:\s*398/.test(myPage)
      && /height:\s*56/.test(myPage),
  },
  {
    name: 'MyPage: disconnect is a flat text action',
    pass: /data-disconnect/.test(myPageDisconnect)
      && !/boxShadow/.test(myPageDisconnect),
  },
  {
    name: 'MyPage: mobile home indicator',
    pass: /data-home-indicator/.test(myPage)
      && /bottom:\s*4/.test(myPage)
      && /width:\s*146/.test(myPage),
  },
];

const failures = checks.filter((check) => !check.pass);
for (const failure of failures) console.error(`FAIL ${failure.name}`);
console.log(`\n${checks.length}개 화면 SVG 사용 검사, 실패 ${failures.length}개`);
process.exit(failures.length ? 1 : 0);
