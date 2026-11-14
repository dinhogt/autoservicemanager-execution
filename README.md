# AutoServiceManager Execution

Microsserviço assíncrono da Entrega 5, responsável por diagnóstico, execução e
cancelamento de ordens de serviço. Implementado em NestJS/TypeScript (Node 22)
com arquitetura hexagonal, DynamoDB, SQS e SNS.

## Arquitetura

```text
SQS -> SqsConsumer -> ProcessCommand -> Execution (domínio)
                           |                 |
                           v                 v
                    DynamoDB adapter    SNS publisher
```

- `domain`: agregado e máquina de estados sem dependência de framework.
- `application`: caso de uso e portas de entrada/saída.
- `infrastructure`: adapters AWS, validação de ambiente e logs JSON.
- `interfaces`: endpoints HTTP operacionais.

A gravação do estado e do marcador `EVENT#<eventId>` ocorre em uma transação
DynamoDB. Reentregas do SQS retornam `duplicate` e não republicam eventos.
Atualizações usam versão otimista. Marcadores expiram em sete dias via atributo
`ttl` (habilite TTL com esse nome na tabela).

## Contratos

Envelope de entrada:

```json
{
  "eventId": "uuid",
  "type": "INICIAR_DIAGNOSTICO",
  "orderId": "uuid",
  "correlationId": "uuid",
  "occurredAt": "2026-09-22T12:00:00.000Z",
  "data": { "diagnosis": "Trocar pastilhas" }
}
```

Comandos aceitos: `INICIAR_DIAGNOSTICO`, `INICIAR_EXECUCAO` e
`CANCELAR_EXECUCAO`. Eventos SNS: `DIAGNOSTICO_CONCLUIDO`,
`EXECUCAO_CONCLUIDA`, `EXECUCAO_FALHOU` e `EXECUCAO_CANCELADA`.
`eventType` e `correlationId` também são publicados como atributos SNS.

Transições:

```text
AGUARDANDO_DIAGNOSTICO -> EM_DIAGNOSTICO -> DIAGNOSTICO_CONCLUIDO
DIAGNOSTICO_CONCLUIDO -> EM_EXECUCAO -> CONCLUIDA
qualquer estado ativo -> CANCELADA | FALHA
```

Estados terminais não aceitam novas transições.

## Execução local

Requer Yarn Classic (`1.22.x`) e Node.js 22.

```bash
cp .env.example .env
yarn install --frozen-lockfile
yarn start:dev
```

O `.env.example` está configurado para LocalStack. Crie uma tabela DynamoDB com
chave composta `pk` (String) + `sk` (String), uma fila SQS e um tópico SNS com
os nomes indicados. Na AWS, omita `AWS_ENDPOINT_URL` e use credenciais via
IAM/IRSA.

- Health: `GET /health`
- Swagger: `GET /docs` (controle por `SWAGGER_ENABLED`)

## Branches

Padrão do projeto (igual aos demais repos):

- `develop` — homologação / trabalho diário
- `master` — produção (somente via PR)

## Qualidade

```bash
yarn lint
yarn test:cov
yarn build
docker build -t autoservicemanager-execution .
kubectl apply -f k8s/execution.yaml
kubectl rollout status deployment/execution -n autoservice --timeout=180s
```

O Jest exige globalmente 90% em statements, lines, branches e functions. A CI
executa lint, testes, build, SonarCloud (quando `SONAR_TOKEN` existe), auditoria
de dependências, Trivy e build da imagem. O container usa usuário sem privilégios
e os manifests aplicam filesystem somente leitura, probes, recursos, HPA, PDB e
IRSA.

Evidência consolidada da Fase 4 (LCOV/HTML): no repositório
`autoservicemanager-app`, pasta `docs/qa/coverage-artifacts/execution/` e
relatório `docs/qa/coverage-evidence-fase4.md`.

O ServiceAccount `autoservice-execution` corresponde ao subject IRSA provisionado
pelo Terraform. O CD usa OIDC, publica somente a tag imutável `github.sha` e roda
apenas com `ENABLE_OIDC_CD=true`. Em falha de rollout, o workflow executa
`kubectl rollout undo deployment/execution -n autoservice`; esse mesmo comando,
seguido de `kubectl rollout status`, é o procedimento de rollback manual.

## Variáveis

Obrigatórias: `AWS_REGION`, `DYNAMODB_TABLE`, `SQS_QUEUE_URL` e
`SNS_TOPIC_ARN`. O bootstrap falha rapidamente quando valores são ausentes ou
inválidos. Consulte `.env.example` para opcionais e defaults.

## Semântica de falhas

Comandos inválidos são descartados depois de registrados, evitando poison
messages. Falhas transitórias de processamento mantêm a mensagem na fila para
nova tentativa/DLQ. Falhas de transição válidas são persistidas e publicadas
como `EXECUCAO_FALHOU`. Configure redrive policy/DLQ na infraestrutura da fila.
