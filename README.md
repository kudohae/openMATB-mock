# OpenMATB 한국어 연구판

2026 공군사관학교 미래 항공우주 학술대회 발표 연구에 쓰는 웹 과제입니다. Cegarra & Valéry의 **OpenMATB 1.5.0** 웹판(https://github.com/juliencegarra/OpenMATB, 커밋 a9405a9)을 한국어 참가자용으로 고친 것입니다.

- 참가자 주소: 저장소의 GitHub Pages 첫 화면. 설문 링크를 붙이려면 주소 뒤에 `?form=<구글 폼 주소>`를 붙입니다.
- 원래 OpenMATB 메뉴: `?admin=1`
- 결과 코드 변환기: `decode.html`
- 이전에 쓰던 단순화 모의 과제: `mock/` (연구에는 쓰지 않음)

## 원본에서 바꾼 점

- 교신 음성: 녹음된 영어 음성 대신 브라우저의 한국어 음성 합성(TTS). 호출부호는 영문자 이름과 무전식 숫자(하나, 둘, 삼, 넷, 오, 여섯, 칠, 팔, 아홉, 공)로 읽습니다. 응답 시간은 음성이 끝난 시점부터 잽니다.
- 키 배정(숫자 키패드 없음): 시스템 감시 1~6, 펌프 Q W E R A S D F, 교신 Z/X(무전기 선택) C/V(주파수) B(확인), 추적은 마우스 끌기.
- 화면 한국어화(ko_KR 번역, Noto Sans KR 글꼴), 한글 입력기 상태에서도 키가 먹도록 키 처리 보완.
- `guide` 플러그인 추가: 과업 화면을 멈춘 채 그 위에 설명 상자와 주황 테두리를 띄우는 튜토리얼.
- 연구용 시나리오(`includes/scenarios/korean/study.txt`, `make_study.py`로 생성): 과업 1 추적 단독(연습 30초, 본 측정 120초), 과업 2 튜토리얼과 1분 연습, 10분 본 블록. 본 블록의 시스템 감시 이상 16건과 자동화 처리 여부(8건 자동, 8건 수동)는 OpenMATB에 들어 있는 Parasuraman, Molloy & Singh(1993) 저신뢰 블록과 같습니다. 원본 블록이 6번 등을 자동화 표시등처럼 켜고 끄던 부분은 넣지 않았습니다. 교신 18건(내 호출부호 10건)과 펌프 고장 4건을 더했습니다.
- 종료 화면에서 요약 점수를 결과 코드(`OM1-…`)로 보여 주고, 원자료는 참가자 브라우저 밖으로 보내지 않습니다.

바뀐 소스 전체는 `korean-adaptation.patch`(원본 커밋 기준 `git apply`)에 있습니다. 실행 파일 묶음(`app.zip`)에도 수정된 파이썬 소스가 그대로 들어 있습니다.

## 라이선스

OpenMATB와 같은 CeCILL 2.1(`LICENSE`)을 따릅니다. Copyright 2023-2026 Julien Cegarra & Benoît Valéry, Institut National Universitaire Champollion. 한국어 수정분도 같은 라이선스로 공개합니다.
