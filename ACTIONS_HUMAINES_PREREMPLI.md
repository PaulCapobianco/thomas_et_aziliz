# Vos actions, dans l'ordre (≈ 10 h au total, étalées jusqu'au 25 octobre)

Rappel du calendrier : gel des nouvelles fonctionnalités **dimanche 25 octobre**, corrections critiques les 26 et 27,
départ du témoin le 29, mariage **samedi 31 octobre**. Codex produira sa propre liste finale (`ACTIONS_HUMAINES.md`) ;
celle-ci vous évite d'attendre.

## Dimanche 11 – mardi 13 octobre (≈ 1 h 30) : ce qui débloque tout
1. **Fournir à Codex** : les prénoms réels (format « Prénom & Prénom »), le lieu (à afficher ou non), la photo `couple.jpg`
   (portrait ou paysage soigné, ≤ 300 Ko ; réduire avec squoosh.app si besoin), 20 vraies photos de téléphone dans un dossier
   (pour mesurer le poids réel : `scripts/estimate_storage.py`).
2. **Créer le projet Supabase** (région Europe) puis suivre `supabase/README.md` section 1 : 3 fichiers SQL, utilisateur admin,
   inscriptions désactivées, ligne dans `admin_users`. Vérifiable : chaque SQL répond « Success ».
3. **Vérification n°1** (`supabase/README.md` section 2, 5 minutes) : copier le bloc dans la console du navigateur.
   Résultats attendus A `error: null`, B/C/E en refus, D `[]`. Si A échoue : plan B (section 5), à signaler à Codex.
4. Donner à Codex l'URL du projet et la clé **publique** (anon/publishable). Jamais la clé `service_role`.

## Mercredi 14 – dimanche 18 octobre (≈ 2 h)
5. Lire `ACTIONS_HUMAINES.md` et `HANDOFF_CLAUDE.md` rédigés par Codex ; décider des points ouverts.
6. **Premier essai sur votre téléphone** : QR ou lien, envoyer 3 photos publiques puis 1 « mariés uniquement » (suivre
   `CHECKLIST_TESTS.md`). Faire la même chose sur un Android (celui d'un proche).
7. Décider du **plan Supabase** (après `estimate_storage.py`) : recommandation = Pro pour octobre.
8. Lancer l'audit ciblé avec `PROMPT_CLAUDE_CODE_AUDIT_MARIAGE.txt` (Claude Code) une fois Codex terminé.

## Lundi 19 – vendredi 23 octobre (≈ 3 h)
9. **Hébergement** : déployer le site (Netlify ou Cloudflare Pages), vérifier HTTPS, noter l'adresse définitive.
10. **Test avec 5 à 10 proches** pendant une soirée : chacun envoie 5 à 10 photos depuis son téléphone, une personne signale
    une photo (un seul signalement suffit) pour vérifier le masquage, vous la restaurez depuis `admin.html` sur iPhone.
11. **QR code** : le générer vers l'adresse définitive + `?k=…`, l'imprimer sur le papier prévu, **le scanner depuis
    plusieurs téléphones** (lumière faible comprise).
12. Créer le compte admin du témoin et lui envoyer `GUIDE_TEMOIN.md`.

## Samedi 24 – dimanche 25 octobre : gel
13. Test final complet (iPhone + Android, réseau mobile faible) ; vérifier le quota dans le tableau de bord Supabase ;
    vérifier que le projet n'est pas en pause.

## 26 – 27 octobre : bugs bloquants uniquement
14. Rien de nouveau. Corriger seulement ce qui empêche d'envoyer, de voir, de masquer.

## 29 – 30 octobre
15. Le témoin se connecte une fois à `admin.html` depuis son téléphone (mot de passe enregistré). Dernier coup d'œil au quota.

## Si quelque chose casse le soir du 31
Pause des publications (`admin.html`), sinon : photos sur un album partagé classique (Google Photos / iCloud) en secours ;
garder ce plan B prêt sur un QR de secours imprimé.
