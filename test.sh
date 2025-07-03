#!/bin/bash

# Ce script envoie une requête POST à la fonction Netlify locale pour la tester.

# Lancer le serveur de développement Netlify en arrière-plan
echo "Lancement du serveur de développement Netlify en arrière-plan..."
netlify dev &
SERVER_PID=$!

# Attendre 15 secondes que le serveur démarre
echo "Attente de 30 secondes que le serveur démarre..."
sleep 30

# Envoyer la requête POST
echo "Envoi de la requête POST à la fonction checkemails..."
curl -X POST http://localhost:8888/checkemails

# Arrêter le serveur Netlify
echo "Arrêt du serveur Netlify (PID: $SERVER_PID)..."
kill $SERVER_PID

echo "Serveur Netlify arrêté."