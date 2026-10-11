# Accès administrateur — diagnostic et mise en place

## Pourquoi la connexion échoue (par ordre de probabilité)

La page `/admin.html` appelle `signInWithPassword` puis la fonction SQL `admin_status()`, qui n'accepte que les `auth.uid()` présents dans
`public.admin_users` (`user_id uuid primary key references auth.users(id)`, vérifié par `public.is_admin()`).

| # | Symptôme affiché | Cause | Remède |
|---|---|---|---|
| 1 | « Ce compte n'a pas accès à l'administration : il est bien connecté, mais n'est pas dans la liste des administrateurs. » | **L'utilisateur existe dans Authentication mais n'a pas de ligne dans `public.admin_users`** (créer l'utilisateur ne suffit pas). Cas le plus probable chez vous. | SQL n°2 ci-dessous |
| 2 | « Cette adresse e-mail n'est pas confirmée… » | Utilisateur créé sans « Auto Confirm User » (le projet exige la confirmation : `mailer_autoconfirm = false`). | Dashboard > Authentication > Users > ⋯ > *Confirm user* (ou SQL n°3) |
| 3 | « Adresse e-mail ou mot de passe incorrect. » | Mauvais mot de passe ou autre adresse. | Dashboard > Users > ⋯ > *Send password recovery* est inutile (pas de page de reset) : utiliser *Reset password* / recréer le mot de passe manuellement |
| 4 | Le message « Chargement de l'administration… » reste affiché, ou rien ne se passe | Page ouverte depuis un fichier (`file://`) ou ancienne version publiée : le JavaScript ne se charge pas. | Utiliser l'adresse HTTPS du site ou `npm run preview` |
| 5 | « Les envois… / L'administration sera disponible après la configuration… » | `config.js` vide au moment du build | Renseigner `config.js`, `npm run build`, republier `dist/` |
| 6 | « Connexion impossible : service injoignable » | Réseau, ou projet Supabase en pause | Vérifier le Dashboard |

Constat sur votre projet (lecture publique, sans écriture) : Auth répond (`invalid_credentials` pour un compte inventé), le fournisseur e-mail
est actif, **mais les inscriptions publiques sont encore autorisées (`disable_signup: false`) et la confirmation e-mail est exigée**. Les migrations
0001-0003 sont appliquées (hosted-check 48/48). La présence de votre ligne dans `admin_users` ne peut pas être vue avec la clé publique : je ne peux pas la confirmer.

## SQL à exécuter dans Supabase > SQL Editor (non destructif)

1. **Diagnostic** (lecture seule) — remplacez l'adresse :
```sql
select u.id, u.email, u.email_confirmed_at is not null as confirme,
       exists (select 1 from public.admin_users a where a.user_id = u.id) as est_admin
from auth.users u
order by u.created_at;
```
Attendu pour vous : `confirme = true`, `est_admin = true`. Si `est_admin = false` : SQL n°2. Si `confirme = false` : SQL n°3.

2. **Autoriser votre utilisateur** (insertion, rejouable, ne supprime rien) :
```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'VOTRE_ADRESSE_EMAIL'
on conflict do nothing;
```
Attendu : `INSERT 0 1` (`INSERT 0 0` si déjà présent ; si 0 et `est_admin = false`, l'adresse est mal orthographiée : relancer le diagnostic).

3. **Confirmer l'adresse si nécessaire** (une ligne modifiée) :
```sql
update auth.users set email_confirmed_at = now()
where email = 'VOTRE_ADRESSE_EMAIL' and email_confirmed_at is null;
```
(équivalent : *Authentication > Users > ⋯ > Confirm user*.)

4. **À faire aussi (sécurité)** : *Authentication > Sign In / Providers* (ou *Settings*) > désactiver **Allow new users to sign up**. Sans cela, n'importe qui peut
créer un compte connecté ; il n'aurait toujours pas accès à l'administration (is_admin), mais ce n'est pas l'état voulu.

## Adresse de l'administration

- **En ligne** : `https://<adresse-du-site>/admin.html` (l'URL de votre hébergeur, par exemple `https://xxxx.pages.dev/admin.html`). Aucun site n'a encore été publié par moi.
- **En local** : `npm run preview` puis http://127.0.0.1:4173/admin.html (HTTP, pas `file://`).
- Projet Supabase : https://yxzxctaobzxmrcvxuifc.supabase.co (le Dashboard est sur https://supabase.com/dashboard/project/yxzxctaobzxmrcvxuifc).

## Vérifier que ça marche

1. Ouvrir `/admin.html` : le formulaire « Connexion » s'affiche, sans message d'erreur.
2. Saisir l'adresse et le mot de passe de l'utilisateur créé dans Authentication. Attendu : tableau de bord avec compteurs (Publiées, Signalées, … Stockage) et onglets.
3. Recharger la page (F5) : vous restez connecté (la session vit dans l'onglet ; fermer l'onglet ou le navigateur sur iPhone demande de se reconnecter, c'est voulu).
4. Onglet « Mariés uniquement » : les miniatures privées s'affichent.
5. « Se déconnecter » : retour au formulaire ; un rechargement ne vous reconnecte pas.
6. Un compte non listé dans `admin_users` doit afficher « n'a pas accès » et ne voir aucune photo privée.
