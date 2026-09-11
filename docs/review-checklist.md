# Lista de verificação para revisores nativos

Aplicar a 20 anúncios por versão, por dois revisores. Cada critério de 1 a 5; média mínima 4 por critério antes de ativar um cliente.

## Texto

1. **Registo** — soa a um consultor imobiliário português, sóbrio e profissional, sem entusiasmo forçado.
2. **Brasileirismos** — zero vocabulário, ortografia ou construções do Brasil (banheiro, térreo, vaga, aluguel, "está fazendo", "você", "a gente", "agende sua visita").
3. **Tipologia e medidas** — T0–T6+, "m²", "350 000 €", "1 250 €/mês", classes energéticas corretas.
4. **Ortografia AO90 (norma de Portugal)** — facto, contacto, receção, aspeto, económico, registo.
5. **Clíticos e sintaxe** — "Trata-se de", "Contacte-nos", "estar a + infinitivo", artigo antes do possessivo.
6. **Fidelidade aos factos** — nada inventado: nem distâncias, nem escolas, nem obras, nem rentabilidades. Todos os números batem com o anúncio.
7. **Persuasão** — benefícios concretos, sem superlativos vazios, uma exclamação no máximo.
8. **Estrutura** — título, resumo, descrição, destaques, localização e CTA coerentes entre si.

## Áudio

9. **Sotaque** — português europeu inequívoco; vogais reduzidas, "s" final chiado, sem entoação brasileira.
10. **Números** — dezasseis, dezassete, dezanove, catorze; "setecentos e quarenta e cinco mil euros"; "T três"; "B menos".
11. **Topónimos** — Algés, Óbidos, Setúbal, Guimarães, Póvoa de Varzim, Sintra pronunciados corretamente.
12. **Ritmo e pausas** — pausas nas mudanças de parágrafo, ritmo moderado, sem cortes entre segmentos.
13. **Qualidade** — sem artefactos, volume estável (−16 LUFS), sem ruído.

## Registo do resultado

Guardar a folha em `evals/reports/<data>-revisao.md` com a média por critério, os anúncios abaixo de 4 e a correção sugerida. Cada correção de vocabulário entra no léxico (`packages/ptpt-qa/src/lexicon/markers.ts`); cada erro de pronúncia entra no glossário do perfil de voz.
