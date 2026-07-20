# Figuras Lumen Health — versões conceituais (high-level)

Documento de apoio ao pedido de patente (depósito INPI via Ungria). Confidencial, pré-depósito.

Estas são versões **conceituais** das quatro figuras, sem numerais de referência e sem a decomposição fina de elementos. Servem para comunicar a invenção em alto nível; os **desenhos formais** (com numerais de referência para o relatório descritivo) ficam a cargo do escritório Ungria.

Arquivos:
- `fig1-fluxo-dados.svg` / `.png` — FIG. 1
- `fig2-ciclo-ingestao.svg` / `.png` — FIG. 2
- `fig3-dominios.svg` / `.png` — FIG. 3
- `fig4-ciclo-inferencia.svg` / `.png` — FIG. 4

Convenções gráficas: linha contínua = fluxo de dados; linha tracejada = fronteira de confiança ou concretização opcional; losango = decisão; boneco palito = revisor humano; retângulo = etapa/módulo.

---

## FIG. 1 — Da coleta ao suporte à decisão clínica

Caminho de ponta a ponta em seis etapas:
1. Fontes heterogêneas de dados.
2. Ingestão e extração estruturada (com proveniência).
3. Portão de confiança ("Confiança suficiente?"): ramo "sim" segue para o registro; ramo "não" vai à revisão clínica humana e depois ao registro.
4. Registro clínico unificado.
5. Desidentificação antes da inferência externa — o serviço de inferência externo (terceiro) recebe apenas dados desidentificados e fica claramente fora da fronteira de confiança.
6. Correlação entre domínios e apresentação, com a interpretação diagnóstica a cargo do médico.

Diferenciais destacados: revisão humana no portão de confiança e fronteira de confiança antes de qualquer inferência externa.

## FIG. 2 — Aprendizado incremental (ciclo virtuoso)

Ciclo horário de quatro etapas: documento de tipo novo (baixa confiança) → revisão clínica (médico) → codificação como regra versionada (determinística, sem retreinar o modelo) → ocorrências seguintes do mesmo tipo processadas automaticamente → (cada novo tipo passa uma única vez). Inset: a taxa de revisão manual por tipo cai com o volume acumulado.

Diferencial destacado: a retroalimentação é determinística (regra versionada), distinta de retreinamento de modelo.

## FIG. 3 — Dimensões configuráveis, não pilares fixos

Três camadas: dimensões configuráveis (N ≥ 2) — física, mental, espiritual e dimensão adicional (tracejada) → motor de correlação entre domínios (alinhamento temporal dos eventos) → indicadores integrados e apresentação. Bloco tracejado opcional "sinais externos (ambiente / epidemiologia)" entra no motor como concretização opcional. Inset: exemplo de alinhamento temporal entre domínios na mesma janela.

Diferencial destacado: arquitetura de dimensões configuráveis com motor de correlação, não a taxonomia fixa de três pilares.

## FIG. 4 — Validação médica como etapa do método

Ciclo de inferência: dados do paciente (desidentificados) → inferência clínica → validação médica (interpretação diagnóstica do médico) → conhecimento incorporado (regra versionada, determinística) → próximo caso (inferência mais barata e mais precisa) → realimenta a inferência. Inset: o custo por caso cai a cada ciclo, sem retreinar o modelo de base.

Diferencial destacado: a validação médica é etapa do método, e o conhecimento incorporado reduz o custo marginal da inferência seguinte.

---

## Especificação de produção

- Dimensão: A4 paisagem, `viewBox="0 0 1754 1240"`.
- SVG monocromático (preto #000000 sobre branco #FFFFFF), apenas primitivas simples (rect, line, path, ellipse, circle, text, polygon, polyline); sem filtros, gradientes, masks, foreignObject ou fontes embutidas.
- Fonte: Helvetica/Arial; corpo de texto ≥ 15 unidades da grade.
- PNG: 3508 × 2480 px (300 dpi).
- Sem numerais de referência, sem marcas/fornecedores, sem radar chart; epidemiologia apenas no bloco tracejado opcional da FIG. 3; linguagem de suporte à decisão clínica (a interpretação diagnóstica permanece com o médico).
