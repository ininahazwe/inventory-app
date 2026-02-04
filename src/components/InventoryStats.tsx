// src/components/InventoryStats.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type StatsData = {
  total: number;
  inStock: number;
  assigned: number;
  repair: number;
  categories: Array<{ name: string; count: number }>;
};

type InventoryStatsProps = {
  refreshTrigger?: number; // Pour forcer le rechargement depuis le parent
  onCategoryFilter?: (category: string) => void; // Callback pour filtrer par catégorie
  selectedCategory?: string; // Catégorie actuellement sélectionnée
};

export default function InventoryStats({
                                         refreshTrigger = 0,
                                         onCategoryFilter,
                                         selectedCategory = ""
                                       }: InventoryStatsProps) {
  const [stats, setStats] = useState<StatsData>({
    total: 0,
    inStock: 0,
    assigned: 0,
    repair: 0,
    categories: []
  });
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    try {
      setLoading(true);

      // Récupérer tous les assets (sans pagination) pour les stats
      const { data: allAssets } = await supabase
        .from("v_asset_overview")
        .select("status, category_name")
        .neq("status", "retired");

      if (!allAssets) return;

      // Calculer les compteurs par statut
      const statusCounts = allAssets.reduce((acc, asset) => {
        acc[asset.status] = (acc[asset.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Calculer les compteurs par catégorie
      const categoryMap = new Map<string, number>();
      allAssets.forEach(asset => {
        const category = asset.category_name || "No category";
        categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
      });

      const categories = Array.from(categoryMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count); // Trier par nombre décroissant

      setStats({
        total: allAssets.length,
        inStock: statusCounts.in_stock || 0,
        assigned: statusCounts.assigned || 0,
        repair: statusCounts.repair || 0,
        categories
      });
    } catch (error) {
      console.error("Erreur lors du chargement des stats:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, [refreshTrigger]);

  const handleCategoryClick = (categoryName: string) => {
    if (!onCategoryFilter) return;

    // Toggle : si déjà sélectionné, décocher
    if (selectedCategory === categoryName) {
      onCategoryFilter("");
    } else {
      onCategoryFilter(categoryName);
    }
  };

  if (loading) {
    return (
      <div style={{
        marginTop: 32,
        padding: "20px",
        background: "#f8f9fa",
        borderRadius: 8,
        //border: "1px solid var(--line)",
        textAlign: "center"
      }}>
        Chargement des statistiques...
      </div>
    );
  }

  return (
    <div style={{
      marginTop: 32,
      padding: "20px",
      //background: "#f8f9fa",
      borderRadius: 8,
      //border: "1px solid var(--line)"
    }}>
      {/* Première ligne : Total, En stock, Assigné */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 18,
          fontWeight: 600,
          marginBottom: 12,
          textAlign: "center",
          color: "var(--brand)"
        }}>
           {stats.total} assets available
        </div>
        <div style={{
          display: "flex",
          justifyContent: "center",
          gap: 24,
          flexWrap: "wrap"
        }}>
          <div style={{
            textAlign: "center",
            padding: "8px 16px",
            background: "#e8f5e8",
            borderRadius: 6,
            //border: "1px solid #c3e6c3"
          }}>
            <div style={{ fontSize: 14, color: "#666", marginBottom: 2 }}>En stock</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "#2d5a2d" }}>
              {stats.inStock}
            </div>
          </div>
          <div style={{
            textAlign: "center",
            padding: "8px 16px",
            background: "#e8f0ff",
            borderRadius: 6,
            //border: "1px solid #c3d9ff"
          }}>
            <div style={{ fontSize: 14, color: "#666", marginBottom: 2 }}>Assigned</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--brand)" }}>
              {stats.assigned}
            </div>
          </div>
          {stats.repair > 0 && (
            <div style={{
              textAlign: "center",
              padding: "8px 16px",
              background: "#fff3cd",
              borderRadius: 6,
              //border: "1px solid #ffeaa7"
            }}>
              <div style={{ fontSize: 14, color: "#666", marginBottom: 2 }}>En réparation</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: "#b98b46" }}>
                {stats.repair}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Deuxième ligne : Catégories */}
      {stats.categories.length > 0 && (
        <div>
          <div style={{
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 12,
            textAlign: "center",
            color: "var(--ink)"
          }}>
            By category
          </div>
          <div style={{
            display: "flex",
            justifyContent: "center",
            gap: 12,
            flexWrap: "wrap",
            maxWidth: "100%"
          }}>
            {stats.categories.map((category) => (
              <div
                key={category.name}
                style={{
                  textAlign: "center",
                  padding: "10px 14px",
                  borderRadius: 6,
                  //border: "1px solid var(--line)",
                  minWidth: 80,
                  cursor: onCategoryFilter ? "pointer" : "default",
                  background: selectedCategory === category.name ? "var(--brand)" : "#fff",
                  color: selectedCategory === category.name ? "#fff" : "var(--ink)",
                  transition: "all 0.2s ease"
                }}
                onClick={() => handleCategoryClick(category.name)}
                onMouseEnter={(e) => {
                  if (onCategoryFilter && selectedCategory !== category.name) {
                    e.currentTarget.style.background = "#f0f0f0";
                  }
                }}
                onMouseLeave={(e) => {
                  if (onCategoryFilter && selectedCategory !== category.name) {
                    e.currentTarget.style.background = "#fff";
                  }
                }}
              >
                <div style={{
                  fontSize: 12,
                  marginBottom: 4,
                  fontWeight: 500,
                  opacity: selectedCategory === category.name ? 1 : 0.7
                }}>
                  {category.name}
                </div>
                <div style={{
                  fontSize: 18,
                  fontWeight: 600
                }}>
                  {category.count}
                </div>
              </div>
            ))}
          </div>
          {selectedCategory && onCategoryFilter && (
            <div style={{
              textAlign: "center",
              marginTop: 12,
              fontSize: 12,
              color: "var(--muted)"
            }}>
              Cliquez à nouveau sur "{selectedCategory}" pour enlever le filtre
            </div>
          )}
        </div>
      )}
    </div>
  );
}
