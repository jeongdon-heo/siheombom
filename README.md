# 시험봄 (siheombom)

PDF 시험지를 업로드하면 AI가 문항을 분석하고, 학생들이 학급코드로 접속해 응시한 결과를 자동/수동/AI로 채점해 주는 웹 앱입니다.

## 기술 스택

- **프론트엔드**: React 18 + Vite + Tailwind CSS + React Router + Recharts
- **백엔드/DB**: Supabase (Postgres + Storage + Auth)
- **AI**: Claude / Gemini (브라우저 직접 호출, 사용자 API 키)
- **PDF**: pdfjs-dist (텍스트 레이어 기반 문항 자동 감지)
- **엑셀**: SheetJS (xlsx)

## 로컬 개발

```bash
npm install
cp .env.example .env       # .env에 Supabase URL/anon key 입력
npm run dev                # http://localhost:5173
```

### 환경변수

| 변수 | 설명 |
|------|------|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |

> AI API 키는 환경변수가 아닌 **교사 설정 화면(`/teacher/settings`)** 에서 입력합니다.

### Supabase 마이그레이션

`supabase/migrations/*.sql` 을 번호 순서대로 Supabase Dashboard SQL Editor에서 실행합니다.
(Supabase CLI를 쓰는 경우 `supabase db push` 도 가능합니다.)

## Vercel 배포

1. **GitHub에 푸시**

   ```bash
   git remote add origin https://github.com/<사용자명>/siheombom.git
   git push -u origin main
   ```

2. **Vercel에서 프로젝트 import**
   - https://vercel.com/new → GitHub repo 선택
   - **Framework Preset**: Vite (자동 감지됨)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

3. **환경변수 설정** (Vercel Project Settings → Environment Variables)
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

4. **Supabase Auth 설정**
   - Supabase Dashboard → Authentication → URL Configuration
   - **Site URL** 또는 **Redirect URLs**에 Vercel 도메인 추가
     (예: `https://siheombom.vercel.app/**`)

5. **배포 완료 확인**
   - 교사 회원가입 → 로그인 → 시험 만들기 → 학생 응시 흐름 점검

## 주요 폴더

```
src/
  components/        ScoreTrendChart 등 공통 컴포넌트
  context/           AuthContext
  lib/               supabase 클라이언트, ai, pdf 유틸
  pages/
    student/         학생용 (학급코드 입력, 시험 보기)
    teacher/         교사용 (홈, 시험 관리, 결과 분석, 학생 명단)
supabase/
  migrations/        SQL 마이그레이션 (번호 순서대로 실행)
```
