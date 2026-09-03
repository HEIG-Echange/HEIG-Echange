import { app } from "./app";
import { scheduleEmailReverificationSweep } from "./jobs/emailReverification";

const port = process.env.PORT ?? 3000;

app.listen(port, () => {
  console.log(`HEIG Échange démarré sur le port ${port}`);
});

// Relance quotidienne des comptes dont la confirmation d'email arrive a
// echeance (6 mois). La suspension elle-meme ne depend pas de ce job : elle se
// deduit de email_verified_at a chaque requete. Le job ne fait qu'envoyer les
// emails de rappel — le demarrer ici (et pas dans app.ts) evite de lancer un
// timer et des requetes SQL pendant les tests, qui importent app.ts.
scheduleEmailReverificationSweep();
