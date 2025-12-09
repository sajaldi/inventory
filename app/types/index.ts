export interface Ubicacion {
    id: number;
    sync_id: string;
    nombre: string;
    tipo: 'edificio' | 'nivel' | 'area';
    parent_id: number | null;
    created_at: string;
    updated_at: string;
    // Helper para UI
    children_count?: number;
}

export interface UbicacionTreeItem extends Ubicacion {
    children?: UbicacionTreeItem[];
}

export interface Categoria {
    id: number;
    sync_id: string;
    nombre: string;
    descripcion?: string;
    icono?: string;
    color?: string;
    parent_id: number | null;
    created_at: string;
    updated_at: string;
    // Helper para UI
    children_count?: number;
}

export interface CategoriaTreeItem extends Categoria {
    children?: CategoriaTreeItem[];
}
