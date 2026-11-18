# 이상한 박물관 · 텍스트 플레이

한 번에 한 명령으로 관람과 상점을 진행하고, 같은 주사위의 제출 순서를 비교하고, 선택한 이유를 기록할 수 있습니다. 그래픽판과 같은 [규칙 엔진](../prototype/game.js)과 [카탈로그](../prototype/catalog.js)를 사용합니다. 두 디렉터리를 저장소 안에 함께 두세요. Node.js 24에서 검증했으며 패키지 설치는 필요 없습니다.

## 시작하기

Windows에서는 [PLAY.cmd](PLAY.cmd)를 더블클릭하세요. 터미널에서는 저장소 루트에서 실행합니다.

```powershell
node prototype_text/cli.mjs
```

첫 화면에 시드, 저장 파일 경로, 여덟 주의 평가 일정이 나옵니다. `start`로 첫 관객을 맞고 `board`로 전시판을 엽니다. 주사위의 `#2=5`는 **2번 주사위에 눈 5가 보인다**는 뜻입니다. `preview 2`로 결과를 확인하고 `submit 2`로 실제 제출합니다.

| 명령 | 용도 |
|---|---|
| `view`, `board`, `inspect 1 1` | 현재 합·배율·토큰 정산 예상, 좌표판, 특정 자리의 효과·방향·충전·주변 토큰 확인 |
| `schedule`, `catalog`, `dice` | 8주 평가 일정, 유물 설명, 주사위의 물리 면 조회 |
| `preview 1 4`, `submit 1 4`, `roll 3` | 선택한 제출의 사건 미리보기, 실제 제출, 지정 주사위 리롤 |
| `end`, `auto` | 즉시 정산, 또는 현재 관객의 남은 관람을 자동 정책에 맡기기 |
| `cell -2 0`, `artifact free 1 1 1` | (−2, 0) 칸 구매, 무료 후보 1번을 (1, 1)에 배치 |
| `artifact shop 2 -2 0 1` | 진열 2번을 (−2, 0)에 배치. 마지막 값은 방향이며 위·오른쪽·아래·왼쪽이 0·1·2·3 |
| `move 0 0 -2 0`, `rotate -2 0`, `sell -2 0` | 상점에서 유물을 옮기거나 회전·판매 |
| `skip`, `next` | 무료 선택권 거절, 다음 관객 입장. 바로 입장해도 이번 상점의 남은 선택권이 만료됨 |
| `note 여기에 판단 근거`, `review`, `quit` | 해당 관람에 메모 추가, 정산·메모·자동 플레이 사용 횟수 조회, 종료 |

같은 상태에서 여러 계획을 시험하려면 `compare 1 4 / 2 / 5 | 1 / 4 / 2 / 5`처럼 입력하세요. `/`는 같은 계획의 다음 제출, `|`는 대안입니다. 각 단계에서 **그때 바로 정산할 경우의 감동**을 보여줍니다. 남기는 주사위까지 같게 분할하면 두 계획의 최종 결과를 비교할 수 있습니다. 미리보기와 비교는 복사본에서 실행해 실제 주사위와 난수 상태를 보존합니다.

## 에이전트가 이어서 플레이하기

새 런은 기본적으로 이 디렉터리의 `runs/`에 자동 기록됩니다. 파일명을 정하면 짧은 호출을 여러 번 나눠 같은 관람에서 이어갈 수 있습니다. 아래 명령은 저장소 루트 기준입니다.

```powershell
node prototype_text/cli.mjs --seed 42 --record prototype_text/runs/my-run.jsonl --do start
node prototype_text/cli.mjs --resume prototype_text/runs/my-run.jsonl --do board --do "preview 1"
node prototype_text/cli.mjs --resume prototype_text/runs/my-run.jsonl --do "note 첫 낱개로 합을 확보한다" --do "submit 1"
node prototype_text/cli.mjs --resume prototype_text/runs/my-run.jsonl
```

진행 명령, 미리보기와 비교, 메모를 JSONL 파일에 순서대로 씁니다. 읽기 전용 재생은 같은 시드에서 명령을 다시 실행해 단계별 상태와 기록된 미리보기 근거를 대조합니다. 특정 관객을 지정하면 입장부터 상점까지의 입력·효과·메모를 출력합니다.

```powershell
node prototype_text/cli.mjs --replay prototype_text/playtests/curator-1119.jsonl
node prototype_text/cli.mjs --replay prototype_text/playtests/curator-1119.jsonl --visit 3.3
```

명령 묶음은 UTF-8 텍스트 파일로 전달할 수 있습니다. 한 줄에 한 명령을 쓰며 빈 줄과 `#`으로 시작하는 설명은 건너뜁니다. 실행할 수 없는 입력을 만나면 해당 줄에서 멈추고 성공한 단계까지 기록합니다.

## 플레이 진단과 재현

| 런 | 방법과 결과 |
|---|---|
| [시드 1120 · 공간 배치와 성장](playtests/independent.md) | 24관객을 에이전트가 직접 진행해 8주차 평가 1,040/600으로 클리어. [기록한 입력과 메모](playtests/independent.commands.txt)를 새 텍스트판으로 재실행해 같은 결과를 확인했습니다. |
| [시드 1119 · 첫 상점 구성 고정](playtests/fixed-board.md) | 첫 상점 후 구성을 고정하고 모든 평가를 직접 진행. 4주차 평가 130/152로 종료. [단계별 기록](playtests/curator-1119.jsonl)에 대안 비교와 보스 피해 예상이 남아 있습니다. |

```powershell
node prototype_text/cli.mjs --seed 1120 --commands prototype_text/playtests/independent.commands.txt
node --test "prototype_text/tests/*.test.mjs" "prototype/tests/*.test.cjs"
```
