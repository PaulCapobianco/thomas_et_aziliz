# Kit Codex — album photo du mariage (V3)

Cette version complète le kit V2 : **rien n'est retiré**, les fichiers V2 sont inchangés (cahier, `index.html`, maquettes,
prompt d'audit), à une exception près : `PROMPT_CODEX_AUTONOME_MARIAGE.txt` est remplacé par sa version V3. Elle ajoute de quoi permettre à Codex de travailler seul.

## Pour lancer Codex
1. Mettre tout le contenu de ce dossier à la racine d'un dépôt Git (ou laisser Codex faire `git init`).
2. Donner à Codex le contenu de `PROMPT_CODEX_AUTONOME_MARIAGE.txt` (c'est la version V3, qui remplace celle du V2).
3. Lui fournir en plus (message ou dossier) : prénoms réels, `couple.jpg`, lieu (optionnel), URL et clé **publique** Supabase quand
   elle existe. Le détail de vos actions : `ACTIONS_HUMAINES_PREREMPLI.md`.

## Carte du kit
| Fichier / dossier | Rôle | Pour qui |
|---|---|---|
| `PROMPT_CODEX_AUTONOME_MARIAGE.txt` | Mission V3 (ordre de lecture, méthode, livrables) | Codex |
| `DECISIONS_PREPAREES.md` | 23 décisions qui lèvent les ambiguïtés du cahier (prime sur lui) | Codex |
| `CAHIER_DES_CHARGES_..._V2.md` | Cahier d'origine, inchangé | Codex |
| `supabase/` | Base de données prête et testée : migrations, tests, contrat d'API, plan B | Codex + vous |
| `assets/` | Couleurs mesurées sur les maquettes, notes de design, textes français | Codex |
| `scripts/` | Photos de test, estimation quota/trafic, copie locale des bibliothèques | Codex |
| `maquettes/`, `index.html` | Références V2, inchangées | Codex |
| `ANALYSE_CAHIER_DES_CHARGES.md` | Ce qui était ambigu, risqué, et ce qui a été vérifié | Vous |
| `ACTIONS_HUMAINES_PREREMPLI.md` | Vos actions datées jusqu'au 25 octobre | Vous |
| `PROMPT_CLAUDE_CODE_AUDIT_MARIAGE.txt` | Audit ciblé après Codex, inchangé | Vous |

## Avertissement honnête
Testé : la base de données, sur PostgreSQL 16 local avec un stub (117 assertions + concurrence, mutations vérifiées).
Non testé : Supabase réel (dépôt anonyme, URL signées, Auth), Edge Function du plan B, `vendor.sh`, tout le code navigateur.
La première chose à faire sur Supabase est la **vérification n°1** (`supabase/README.md`, section 2).
