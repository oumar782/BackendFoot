// TerrainAdmin.jsx
import React, { useState, useEffect } from 'react';
import './TerrainAdmin.css';

const TerrainAdmin = () => {
  const [terrains, setTerrains] = useState([]);
  const [formData, setFormData] = useState({
    nomterrain: '',
    typeterrain: '',
    surface: '',
    descriptions: '',
    tarif: '',
    equipementdispo: '',
    photo: ''
  });
  const [editingId, setEditingId] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Votre clé API ImgBB (obtenue gratuitement ici : https://api.imgbb.com/)
  const IMG_BB_API_KEY = 'YOUR_IMG_BB_API_KEY'; // ← REMPLACEZ CETTE CHAINE

  // Afficher un toast
  const showToast = (message, type = 'success') => {
    const id = Date.now();
    const newToast = { id, message, type };
    setToasts(prev => [...prev, newToast]);
    
    setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, 3000);
  };

  // Récupérer tous les terrains
  const fetchTerrains = async () => {
    setLoading(true);
    try {
      const response = await fetch('https://backend-foot-omega.vercel.app/api/terrain/');
      const data = await response.json();
      
      if (data.success) {
        setTerrains(data.data);
      } else {
        showToast('Erreur lors du chargement des terrains', 'error');
      }
    } catch (error) {
      showToast('Erreur de connexion au serveur', 'error');
      console.error('Erreur:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTerrains();
  }, []);

  // Gérer les changements dans le formulaire
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Uploader une image vers ImgBB (remplace Cloudinary)
  const uploadImage = async (file) => {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('key', IMG_BB_API_KEY); // Votre clé API

    try {
      const response = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      if (data.data && data.data.url) {
        return data.data.url;
      } else {
        throw new Error('Échec de l\'upload');
      }
    } catch (error) {
      console.error('Erreur ImgBB:', error);
      showToast('Erreur lors de l\'upload de l\'image', 'error');
      return null;
    }
  };

  // Gérer l'upload d'image
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const imageUrl = await uploadImage(file);
    if (imageUrl) {
      setFormData(prev => ({ ...prev, photo: imageUrl }));

      if (editingId) {
        setTerrains(prev =>
          prev.map(terrain =>
            terrain.numeroterrain === editingId
              ? { ...terrain, photo: imageUrl }
              : terrain
          )
        );
      }

      showToast('Image téléchargée avec succès');
    }
  };

  // Créer un nouveau terrain
  const handleCreate = async (e) => {
    e.preventDefault();
    
    if (!formData.nomterrain || !formData.typeterrain || !formData.surface || !formData.tarif) {
      showToast('Veuillez remplir tous les champs obligatoires', 'error');
      return;
    }
    
    try {
      const response = await fetch('https://backend-foot-omega.vercel.app/api/terrain/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      
      const data = await response.json();
      
      if (data.success) {
        showToast('Terrain créé avec succès');
        setTerrains(prev => [...prev, data.data]);
        setFormData({
          nomterrain: '',
          typeterrain: '',
          surface: '',
          descriptions: '',
          tarif: '',
          equipementdispo: '',
          photo: ''
        });
        setShowForm(false);
      } else {
        showToast(data.message || 'Erreur lors de la création', 'error');
      }
    } catch (error) {
      showToast('Erreur de connexion', 'error');
      console.error('Erreur:', error);
    }
  };

  // Mettre à jour un terrain
  const handleUpdate = async (e) => {
    e.preventDefault();
    
    if (!formData.nomterrain || !formData.typeterrain || !formData.surface || !formData.tarif) {
      showToast('Veuillez remplir tous les champs obligatoires', 'error');
      return;
    }
    
    try {
      const response = await fetch(`https://backend-foot-omega.vercel.app/api/terrain/${editingId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      
      const data = await response.json();
      
      if (data.success) {
        showToast('Terrain modifié avec succès');
        setTerrains(prev =>
          prev.map(terrain =>
            terrain.numeroterrain === editingId
              ? data.data
              : terrain
          )
        );
        setFormData({
          nomterrain: '',
          typeterrain: '',
          surface: '',
          descriptions: '',
          tarif: '',
          equipementdispo: '',
          photo: ''
        });
        setEditingId(null);
        setShowForm(false);
      } else {
        showToast(data.message || 'Erreur lors de la modification', 'error');
      }
    } catch (error) {
      showToast('Erreur de connexion', 'error');
      console.error('Erreur:', error);
    }
  };

  // Supprimer un terrain
  const handleDelete = async (id) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer ce terrain ?')) return;
    
    try {
      const response = await fetch(`https://backend-foot-omega.vercel.app/api/terrain/${id}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        showToast('Terrain supprimé avec succès');
        setTerrains(prev => prev.filter(terrain => terrain.numeroterrain !== id));
      } else {
        showToast(data.message || 'Erreur lors de la suppression', 'error');
      }
    } catch (error) {
      showToast('Erreur de connexion', 'error');
      console.error('Erreur:', error);
    }
  };

  const handleEdit = (terrain) => {
    setFormData({
      nomterrain: terrain.nomterrain || '',
      typeterrain: terrain.typeterrain || '',
      surface: terrain.surface || '',
      descriptions: terrain.descriptions || '',
      tarif: terrain.tarif || '',
      equipementdispo: terrain.equipementdispo || '',
      photo: terrain.photo || ''
    });
    setEditingId(terrain.numeroterrain);
    setShowForm(true);
  };

  const handleCancel = () => {
    setFormData({
      nomterrain: '',
      typeterrain: '',
      surface: '',
      descriptions: '',
      tarif: '',
      equipementdispo: '',
      photo: ''
    });
    setEditingId(null);
    setShowForm(false);
  };

  return (
    <div className="terrain-admin">
      <header className="admin-header">
        <h1>Administration des Terrains</h1>
        <button 
          className="btn btn-primary"
          onClick={() => setShowForm(true)}
        >
          Ajouter un Terrain
        </button>
      </header>

      {showForm && (
        <div className="form-overlay">
          <div className="form-container">
            <h2>{editingId ? 'Modifier le Terrain' : 'Ajouter un Terrain'}</h2>
            <form onSubmit={editingId ? handleUpdate : handleCreate}>
              <div className="form-group">
                <label>Nom du terrain *</label>
                <input
                  type="text"
                  name="nomterrain"
                  value={formData.nomterrain}
                  onChange={handleInputChange}
                  required
                />
              </div>

              <div className="form-group">
                <label>Type de terrain *</label>
                <select
                  name="typeterrain"
                  value={formData.typeterrain}
                  onChange={handleInputChange}
                  required
                >
                  <option value="">Sélectionnez un type</option>
                  <option value="football">Football</option>
                  <option value="basketball">Basketball</option>
                  <option value="tennis">Tennis</option>
                  <option value="rugby">Rugby</option>
                </select>
              </div>

              <div className="form-group">
                <label>Surface *</label>
                <select
                  name="surface"
                  value={formData.surface}
                  onChange={handleInputChange}
                  required
                >
                  <option value="">Sélectionnez une surface</option>
                  <option value="7x7">7x7</option>
                  <option value="9x9">9x9</option>
                  <option value="11x11">11x11</option>
                </select>
              </div>

              <div className="form-group">
                <label>Tarif (€/heure) *</label>
                <input
                  type="number"
                  name="tarif"
                  value={formData.tarif}
                  onChange={handleInputChange}
                  min="0"
                  step="0.01"
                  required
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  name="descriptions"
                  value={formData.descriptions}
                  onChange={handleInputChange}
                  rows="3"
                />
              </div>

              <div className="form-group">
                <label>Équipements disponibles</label>
                <input
                  type="text"
                  name="equipementdispo"
                  value={formData.equipementdispo}
                  onChange={handleInputChange}
                />
              </div>

              <div className="form-group">
                <label>Photo</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                />
                {formData.photo && (
                  <div className="image-preview">
                    <img 
                      src={formData.photo} 
                      alt="Aperçu" 
                      style={{ 
                        width: '100%', 
                        maxWidth: '200px', 
                        height: 'auto', 
                        borderRadius: '8px', 
                        marginTop: '8px', 
                        border: '1px solid #ddd' 
                      }} 
                    />
                  </div>
                )}
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary">
                  {editingId ? 'Modifier' : 'Créer'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="terrains-list">
        {loading ? (
          <div className="loading">Chargement...</div>
        ) : terrains.length === 0 ? (
          <div className="empty-state">
            <p>Aucun terrain disponible</p>
          </div>
        ) : (
          <div className="terrains-grid">
            {terrains.map(terrain => (
              <div key={terrain.numeroterrain} className="terrain-card">
                <div className="terrain-image">
                  {terrain.photo ? (
                    <img 
                      src={terrain.photo} 
                      alt={terrain.nomterrain}
                      onError={(e) => {
                        console.warn("Image non chargée :", terrain.photo);
                        e.target.src = "/placeholder.png"; // Ajoutez un placeholder local si nécessaire
                      }}
                      style={{ 
                        width: '100%', 
                        height: '180px', 
                        objectFit: 'cover', 
                        borderRadius: '8px',
                        border: '1px solid #e0e0e0'
                      }} 
                    />
                  ) : (
                    <div style={{
                      width: '100%',
                      height: '180px',
                      backgroundColor: '#f8f9fa',
                      border: '2px dashed #ccc',
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#6c757d',
                      fontSize: '14px',
                      fontWeight: '500',
                      textAlign: 'center',
                      userSelect: 'none'
                    }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16" style={{ marginBottom: '8px', opacity: 0.7 }}>
                        <path d="M6.002 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm4.002-6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm4.002 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM13 1a1 1 0 0 0-1 1v1h-1a1 1 0 0 0 0 2h1v1a1 1 0 0 0 2 0v-1h1a1 1 0 0 0 0-2h-1V2a1 1 0 0 0-1-1z"/>
                      </svg>
                      Pas d'image
                    </div>
                  )}
                </div>
                <div className="terrain-info">
                  <h3>{terrain.nomterrain}</h3>
                  <p><strong>Type:</strong> {terrain.typeterrain}</p>
                  <p><strong>Surface:</strong> {terrain.surface}</p>
                  <p><strong>Tarif:</strong> {terrain.tarif} €/heure</p>
                  {terrain.descriptions && (
                    <p><strong>Description:</strong> {terrain.descriptions}</p>
                  )}
                  {terrain.equipementdispo && (
                    <p><strong>Équipements:</strong> {terrain.equipementdispo}</p>
                  )}
                </div>
                <div className="terrain-actions">
                  <button 
                    className="btn btn-edit"
                    onClick={() => handleEdit(terrain)}
                  >
                    Modifier
                  </button>
                  <button 
                    className="btn btn-delete"
                    onClick={() => handleDelete(terrain.numeroterrain)}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TerrainAdmin;