# 여행의 조각들 — GitHub Pages + Supabase 동기화판

기존 웹사이트 디자인을 유지한 **개인용 클라우드 동기화판**입니다. 별도 서버 없이 GitHub Pages와 Supabase를 사용합니다. 배포 전 실제 Supabase 연결 검증이 필요합니다.

## 배포 전에 꼭 할 일

1. **기존 웹사이트에 먼저 접속**해 `설정 → JSON 백업 저장`을 눌러 원본 JSON을 안전하게 보관합니다. 사진이 많이 들어 있다면 파일 크기가 클 수 있습니다. 기존 저장 브라우저의 데이터를 지우지 마세요.
2. [Supabase](https://supabase.com/dashboard)에서 새 프로젝트를 생성합니다. 프로젝트가 준비되면 `SQL Editor`에 `schema.sql`을 붙여넣어 실행합니다. SQL에는 비공개 사진 버킷과 본인 폴더 접근 정책까지 들어 있습니다.
3. Supabase `Authentication → Users`에서 **본인 이메일을 사용자로 초대(Invite)** 합니다. 초대 메일의 링크로 계정을 활성화합니다. `Authentication` 설정에서 새 사용자 공개 가입을 차단하세요. 웹에서 로그인할 때는 `shouldCreateUser:false`를 사용합니다.
4. `Authentication → URL Configuration`에서 **Site URL**과 **Redirect URLs**에 사용 중인 GitHub Pages의 정확한 주소(예: `https://사용자명.github.io/저장소명/`)를 등록합니다. GitHub Pages의 서브경로 `/저장소명/`까지 맞아야 합니다. 로그인 이메일 템플릿과 SMTP 발송 제한은 Supabase 설정에 따릅니다.
5. Supabase의 `Project Settings → Data API` 화면에서 **Project URL**, `Project Settings → API Keys`에서 **publishable key** (`sb_publishable_...`, 구 프로젝트는 `anon` key)를 확인합니다. 파일 `supabase-config.js`의 `url`, `publishableKey` 두 부분만 수정하세요. **secret / service_role 키를 사용하거나 GitHub에 올리면 안 됩니다.** 이 공개용 키는 RLS 정책으로 보호됩니다.
6. 먼저 **테스트용 GitHub Pages 저장소 또는 별도 브랜치**에 아래 파일을 함께 올립니다: `index.html`, `cloud-sync.js`, `supabase-config.js`. SQL과 README 파일은 GitHub 웹사이트 작동에 필요하지 않습니다. 한 폴더에 놓아야 상대 경로로 읽힙니다.
7. 웹사이트 접속 → 본인 이메일 로그인 링크 받기 → 이메일의 링크 열기 → 여행 기록 저장 테스트. PC에서 제목·색깔·사진을 넣고, 휴대전화에서 같은 계정으로 로그인하여 확인합니다. 삭제도 테스트합니다.
8. 테스트 후 원본 JSON을 `설정 → 백업 불러오기`로 가져옵니다. 기존 브라우저라면 `이 브라우저의 이전 기록 가져오기`도 가능합니다. 이 버튼은 기존 브라우저의 `localStorage`를 읽어 올릴 뿐, 원래 데이터를 삭제하지 않습니다.
9. 여행 수, 사진 수, 색칠된 지역 수를 기존 기록과 대조하고 PC·휴대전화 동기화를 검증한 뒤에 기존 GitHub Pages 저장소의 파일을 교체합니다.

## 파일 설명

- `index.html` — 원본의 지도, 여행일기, 사진 UI 유지. 로그인 화면과 동기화 표시가 추가된 버전
- `cloud-sync.js` — 로그인·실시간 알림·여행/색상/사진 저장·삭제 및 사진 포함 JSON 백업
- `supabase-config.js` — 본인 Supabase URL 및 공개용 키 입력
- `schema.sql` — DB, 비공개 버킷, RLS 및 Realtime 설정

## 사용법 및 유의사항

- **원본 브라우저 데이터는 건드리지 않습니다.** 새 버전은 클라우드 데이터를 기본으로 읽습니다. 기존 JSON을 가져오기 전에는 클라우드 화면이 비어 보이는 것이 정상입니다.
- 동기화는 최초 로그인, 다른 기기 변경 알림, 창 재진입 및 `↻ 동기화` 버튼에서 수행됩니다. 메모 편집 중에는 자동 새로고침을 보류하여 입력 중인 내용을 보호합니다.
- 편집·업로드는 **온라인 연결이 필요**합니다. 현재 버전은 인터넷 연결이 끊긴 상태에서의 변경 사항 큐잉을 구현하지 않았습니다.
- 서로 다른 기기에서 같은 메모를 동시에 수정하면 수정 시각으로 충돌을 감지합니다. 이 경우 다른 기기에서 수정된 기록을 갱신한 후 재시도해야 합니다.
- 사진은 기존 코드처럼 가장 긴 변 1,050픽셀, JPEG 품질 0.72로 줄여 저장됩니다. 사진 원본 화질이 아닌 **압축본**이 보관됩니다. 원본 사진은 본인의 별도 저장소에 보존하세요.
- `설정 → JSON 백업 저장`은 개인 비공개 사진을 다운로드하여 Base64로 JSON 안에 포함하므로 사진이 많을수록 다운로드 파일이 커집니다. 백업 파일은 개인적으로 보관하세요.
- 새 버전은 JSON 백업을 가져올 때 **동일 여행 ID를 덮어쓰고**, 다른 ID는 남깁니다. 데이터가 많으면 업로드 중간 실패 가능성이 있어 중단 시 다시 실행·검증이 필요합니다.
- 무료 Supabase 프로젝트는 장기간 미사용 시 일시 중지될 수 있습니다. 사용량, 이메일 발송량, 프로젝트 중지와 요금 정책은 Supabase 대시보드에서 확인하세요. 무료 제공량과 조건은 변경될 수 있습니다.
- GitHub Pages는 정적 파일만 제공하며 Supabase 테이블에 접근하는 것은 로그인 후의 브라우저입니다. RLS 정책을 끄지 마세요.
- 사진 삭제 후 저장소에서 정리 중 오류가 나면 공간이 일부 남을 수 있습니다. Supabase Storage에서 해당 개인 폴더의 남은 파일을 점검할 수 있습니다.
- 이 패키지는 실행 가능한 소스의 **초안/테스트 배포본**입니다. 실제 Supabase 계정에 대한 통합 테스트는 여기서 수행되지 않았습니다.

## 공식 참고 문서

- https://supabase.com/docs/reference/javascript/installing
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/storage/buckets/fundamentals
- https://supabase.com/docs/guides/realtime/postgres-changes
