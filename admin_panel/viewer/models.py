from django.db import models

class Activos(models.Model):
    id = models.AutoField(primary_key=True)
    sync_id = models.TextField(unique=True)
    codigo = models.TextField(unique=True)
    nombre = models.TextField()
    edificio = models.TextField(blank=True, null=True)
    nivel = models.TextField(blank=True, null=True)
    categoria = models.TextField(blank=True, null=True)
    espacio = models.TextField(blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, blank=True, null=True)
    deleted = models.IntegerField(blank=True, null=True)
    serie = models.TextField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'activos'
        verbose_name_plural = "Activos"

class Auditorias(models.Model):
    id = models.AutoField(primary_key=True)
    sync_id = models.TextField(unique=True)
    espacio = models.TextField(blank=True, null=True)
    fecha = models.TextField(blank=True, null=True)
    total_esperados = models.IntegerField(blank=True, null=True)
    total_escaneados = models.IntegerField(blank=True, null=True)
    total_faltantes = models.IntegerField(blank=True, null=True)
    total_sobrantes = models.IntegerField(blank=True, null=True)
    codigos_escaneados = models.TextField(blank=True, null=True)
    codigos_faltantes = models.TextField(blank=True, null=True)
    codigos_sobrantes = models.TextField(blank=True, null=True)
    estado = models.TextField(blank=True, null=True)
    notas = models.TextField(blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, blank=True, null=True)
    plano_id = models.IntegerField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'auditorias'
        verbose_name_plural = "Auditorías"

class Categorias(models.Model):
    id = models.AutoField(primary_key=True)
    sync_id = models.TextField(unique=True)
    nombre = models.TextField()
    descripcion = models.TextField(blank=True, null=True)
    icono = models.TextField(blank=True, null=True)
    color = models.TextField(blank=True, null=True)
    parent_id = models.IntegerField(blank=True, null=True)
    created_at = models.DateTimeField(blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, blank=True, null=True)
    deleted = models.IntegerField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'categorias'
        verbose_name_plural = "Categorías"
