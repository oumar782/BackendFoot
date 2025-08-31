import express from "express";
import pool from "../db.js";  // ta connexion PostgreSQL

const router = express.Router();
// Affichage
router.get("/", async (req, res) => {
    try {
        const result = await pool.query( "SELECT * FROM creneaux ORDER BY datecreneaux, heure");
        res.json(result.rows);
       } catch(err) {
           res.status(500).send(err.message);
}
} );
// Ajouter creneaux
router.post("/", async (req, res) => {
    const {
         datecreneaux,
         heure, 
         heurefin, 
         statut, 
         numeroterrain, 
         typeterrain, 
         nomterrain, 
         surfaceterrains,
         idcreneaux
        } = req.body;

    try {
        const result = await pool.query( 
         "INSERT INTO creneaux (datecreneaux, heure, heurefin, statut, numeroterrain, typeterrain, nomterrain, surfaceterrains) VALUES ($1, $2, $3, $4,$5, $6, $7, $8) RETURNING * ",
        [datecreneaux, heure, heurefin, statut, numeroterrain, typeterrain, nomterrain, surfaceterrains]);
         res.json(result.rows[0]);

       } catch(err) {
           res.status(500).send(err.message);
}
} );

//modifier un créneau
router.put("/:id",  async (req, res) => 
{  const id= req.params.id;
    const {datecreneaux, heure, heurefin, statut, numeroterrain, typeterrain, nomterrain, surfaceterrains} = req.body ;
     try {
        const result = await pool.query("UPDATE creneaux SET datecreneaux=$1, heure=$2, heurefin=$3, statut=$4, numeroterrain=$5, typeterrain=$6, nomterrain=$7, surfaceterrains=$8 WHERE idcreneaux =$9 RETURNING *",
            [ 
                datecreneaux, 
                heure, 
                heurefin, 
                statut, 
                numeroterrain, 
                typeterrain, 
                nomterrain, 
                surfaceterrains, 
                id,                
            ]
        );

        if (result.rows.length === 0) {
      return res.status(404).send("Créneau non trouvé");
    }

    res.json(result.rows[0]);
     } catch(err) {
         res.status(400).send(err.message);
     }
});

// supprimer un creneau
router.delete("/:id",  async (req, res) => {
    const id = req.params.id;
    try{
        const result = await pool.query("DELETE FROM creneaux WHERE idcreneaux=$1 RETURNING *", [id] );
          if (result.rows.length === 0) {
           return res.status(404).send("créneau non dispo");
         }
          res.json({message: "créneau supprimé"});
            
    } catch(err) {
        res.status(500).send(err.message);
    }
});

export default router;


