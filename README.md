# 업무 검토 보드

설계안·업무 조사 내용을 문서로 올리고, **항목마다 Y / N 과 의견**을 받아 한곳에 모으는 정적 웹 보드입니다.
같은 **공유 암호**를 쓰는 사람끼리 서로의 회신을 바로 볼 수 있습니다.

- 호스팅: **Cloudflare Pages** (정적 파일)
- 저장소: **Firebase Firestore** (REST API 직접 호출 — SDK 번들 없음)
- 신원: **익명 인증**, 접근 통제는 공유 암호

암호를 넣지 않아도 문서는 읽고 회신을 작성할 수 있고, 그 경우 입력값은 브라우저에만 저장됩니다.
암호로 입장하면 그 순간부터 자동으로 공유 저장이 켜집니다.

---

## 1. 구조

```
public/                         ← Cloudflare Pages 배포 대상
├─ index.html                   문서 목록(포털) + 암호 게이트
├─ assets/
│  ├─ app.css                   공통 스타일 (라이트/다크 자동)
│  ├─ board-core.js             암호 게이트 · 익명 인증 · Firestore REST
│  ├─ review.js                 회신 위젯 · 요약 · 전체 응답 화면
│  └─ firebase-config.js        ★ 프로젝트 값 두 개만 채우면 끝
└─ docs/
   └─ s04-purchase-progress-status.html   검토 문서 #1

firestore.rules                 보안 규칙
firebase.json                   규칙 배포용
wrangler.toml                   Cloudflare Pages 설정
tools/inline.mjs                단일 HTML 파일로 묶기 (메일 첨부용)
```

데이터 경로:

```
rooms/{roomKey}/meta/room                        방 이름
rooms/{roomKey}/docs/{docId}/responses/{uid}     사람별 회신
```

`roomKey`는 공유 암호를 SHA-256 해시한 값입니다. 암호를 모르면 경로 자체를 만들 수 없습니다.

---

## 2. 세팅 (한 번만)

### 2-1. Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) 에서 프로젝트 생성
2. **빌드 → Firestore Database → 데이터베이스 만들기** (프로덕션 모드, 리전은 `asia-northeast3` 권장)
3. **빌드 → Authentication → 로그인 방법 → 익명** 사용 설정 ← 빠뜨리면 저장이 안 됩니다
4. **프로젝트 설정 → 일반 → 내 앱 → 웹 앱 추가** 후 `apiKey`, `projectId` 확인
5. `public/assets/firebase-config.js` 에 두 값을 붙여넣기

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  projectId: "my-project-id"
};
```

6. 보안 규칙 적용 — 콘솔의 **Firestore → 규칙** 탭에 `firestore.rules` 내용을 붙여넣고 게시하거나:

```bash
npx firebase login
npx firebase use <projectId>
npm run rules
```

> `apiKey`와 `projectId`는 브라우저에 노출되는 공개 식별자입니다. 실제 통제는 규칙과 공유 암호가 합니다.
> 서비스 계정 키(JSON)는 이 저장소에 절대 넣지 마세요.

### 2-2. Cloudflare Pages

```bash
npm install
npx wrangler login
npm run deploy          # public/ 을 review-board 프로젝트로 배포
```

처음 실행하면 프로젝트 생성 여부를 물어봅니다. 배포가 끝나면
`https://review-board.pages.dev` 형태의 주소가 나옵니다.

GitHub 연동으로 배포하려면 Cloudflare 대시보드 → **Workers & Pages → Create → Pages → Connect to Git**
에서 이 저장소를 고르고 다음처럼 설정합니다.

| 항목 | 값 |
| --- | --- |
| Framework preset | None |
| Build command | *(비움)* |
| Build output directory | `public` |

### 2-3. 첫 입장

1. 배포된 주소를 열면 암호 입력창이 나옵니다.
2. 처음 쓰는 암호면 **새 공간 이름**을 물어봅니다. 이름을 정하면 공간이 만들어집니다.
3. 이후에는 같은 암호를 넣은 사람 모두 같은 공간으로 들어옵니다.

> 오타 방지: 존재하지 않는 암호를 넣으면 바로 통과시키지 않고 "새 공간을 만들지" 되묻습니다.

---

## 3. 로컬에서 확인

```bash
npm run serve      # http://localhost:8080  (파이썬 정적 서버)
# 또는
npm run dev        # http://localhost:8788  (wrangler pages dev)
```

공유 저장은 HTTPS 또는 localhost 에서만 동작합니다(WebCrypto 요구사항).

---

## 4. 문서 추가하기

1. `public/docs/` 에 새 HTML 파일을 만듭니다. 기존 문서를 복사해 쓰는 게 가장 빠릅니다.
2. 본문은 자유롭게 쓰고, 회신을 받고 싶은 위치에 자리표시자를 둡니다.

```html
<div data-review="q1"></div>                          <!-- 큰 회신 박스 -->
<div data-review="q7" data-variant="inline"></div>     <!-- 카드 안에 들어가는 작은 형태 -->
```

3. 파일 끝에서 문서를 정의합니다.

```html
<script src="../assets/firebase-config.js"></script>
<script src="../assets/board-core.js"></script>
<script>
window.REVIEW_DOC = {
  id: "s05-vendor-master",              // 저장 키 — 한 번 정하면 바꾸지 마세요
  code: "MERP S05",
  title: "Vendor Master 설계",
  items: [
    { id:"q1", sec:"01", label:"코드 체계", q:"제안한 코드 체계에 동의하십니까?", hint:"보조 설명" },
    { id:"q7", sec:"03", label:"중복 검증", q:"중복 검증 규칙에 동의하십니까?", variant:"inline" }
  ]
};
</script>
<script src="../assets/review.js"></script>
```

4. `public/index.html` 의 `window.BOARD_DOCS` 배열에 한 줄 추가하면 목록에 나타납니다.

상단바·검토자 입력칸·요약·전체 응답 화면은 `review.js` 가 자동으로 만듭니다.
문서 페이지에는 `<div id="topbarMount"></div>`, `<div id="reviewerMount"></div>`,
`<div id="summaryMount"></div>` 세 개의 자리만 있으면 됩니다.

### 항목(item) 필드

| 필드 | 설명 |
| --- | --- |
| `id` | 저장 키. 문서 안에서 유일해야 하며 나중에 바꾸면 기존 회신과 연결이 끊깁니다 |
| `sec` | 화면의 섹션 번호. 회신 텍스트에 함께 찍힙니다 |
| `label` | 요약표·취합본에 쓰이는 짧은 이름 |
| `q` | 질문 문장 |
| `hint` | (선택) 질문 아래 보조 설명 |
| `variant` | (선택) `"inline"` 이면 카드 안에 들어가는 작은 형태 |

---

## 5. 쓰는 방법 (검토자용)

- **동의(Y) / 수정 필요(N) / 보류** 중 하나를 고르고 의견을 적습니다. N은 사유가 필수입니다.
- 입력하는 즉시 저장됩니다. 상단 배지가 `저장됨` 으로 바뀝니다.
- **전체 응답** 버튼으로 다른 사람의 회신과 항목별 집계를 봅니다.
- **회신 복사** 로 메신저·메일에 붙여넣을 텍스트를 얻습니다.

---

## 6. 알아둘 점

- 암호를 아는 사람은 그 공간의 **모든 문서와 회신을 읽고 쓸 수** 있습니다. 열람만 가능한 권한은 없습니다.
- 익명 인증이라 이름은 본인이 적은 값 그대로입니다. 신원 확인이 필요하면 회사 SSO 연동이 따로 필요합니다.
- 회신은 브라우저 단위(uid)로 구분됩니다. 다른 기기·시크릿 창에서 열면 새 회신이 됩니다.
- 파일 하나로 전달해야 할 때는 `node tools/inline.mjs <문서경로>` 로 `dist/` 에 단일 HTML을 만듭니다.
  이 파일은 공유 저장 없이 로컬 저장 모드로만 동작합니다.
