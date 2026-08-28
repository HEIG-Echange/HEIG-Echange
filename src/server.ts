import { app } from "./app";
import { scheduleEmailReverificationSweep } from "./jobs/emailReverification";
import { initStorage } from "./storage";

const port = process.env.PORT ?? 3000;

// Cree le bucket MinIO s'il manque (ou le dossier d'uploads en mode local).
// Ne bloque pas le demarrage : si MinIO n'est pas encore pret, l'app repond
// quand meme et le premier upload retentera. Appel ici et pas dans app.ts pour
// ne rien declencher pendant les tests, qui importent app.ts.
void initStorage();

app.listen(port, () => {
  console.log(`HEIG Échange démarré sur le port ${port}`);
});

// Relance quotidienne des comptes dont la confirmation d'email arrive a
// echeance (6 mois). La suspension elle-meme ne depend pas de ce job : elle se
// deduit de email_verified_at a chaque requete. Le job ne fait qu'envoyer les
// emails de rappel — le demarrer ici (et pas dans app.ts) evite de lancer un
// timer et des requetes SQL pendant les tests, qui importent app.ts.
scheduleEmailReverificationSweep();
