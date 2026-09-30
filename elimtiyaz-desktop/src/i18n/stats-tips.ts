/**
 * stats-tips — T-447 (UI-325): the bilingual Statistics tooltip glossary.
 *
 * The owner's mandate: "Add explanations to every Statistics card, chart,
 * metric, header, slicer, and control. Tooltips must explain what the
 * element measures, how it is calculated, and what its status means. Do
 * not hardcode explanations directly inside JSX. Use the existing i18n
 * system or a strongly typed centralized glossary. Support French and
 * English."
 *
 * This file IS that centralized glossary, consumed through the EXISTING
 * i18n system (react-i18next — registered by i18n.ts via deepMerge, so
 * every key resolves through the standard `t()` lookup with fr fallback).
 * Keeping it in its own module (not inside fr/en/ar.ts) is deliberate:
 * the hand-maintained base dictionaries stay untouched (smaller merge
 * footprint), and the THREE locale trees are compile-time locked to the
 * SAME shape — `STAT_TIPS_EN`/`STAT_TIPS_AR` are typed as
 * `StatsTipDictionary` (the FR tree's shape), so a missing/renamed key in
 * ANY locale fails `npm run typecheck`, and the runtime parity check
 * (scripts/i18n/check-parity.mjs) covers the merged dictionaries.
 *
 * Entry shape (every field required except `status`):
 *   title    — the element's name (the tooltip's heading)
 *   measures — WHAT the element measures (the mandate's first ask)
 *   calc     — HOW it is calculated (the formula, the source rows)
 *   status?  — WHAT the state/colors mean (where the element renders a
 *              verdict — the §15.66b audit-in-place principle)
 *
 * The texts describe the CANONICAL derivations (the §15.53a rule): the
 * percentages are the PARITY-001 convention; the remaining is INV-4;
 * the waves are the canonical (category × tranche 1..3) grouping with the
 * ALL-categories pooled main analysis; the status colors follow the
 * documented phase semantics.
 *
 * NOTE: the FR texts are the reference; EN/AR translate them. When a
 * derivation's semantics change, update the FR text FIRST (it is the
 * documentation of record), then its translations.
 */

/** One glossary entry — title + measures + calculation (+ status when the element renders a verdict). */
export interface StatsTipEntry {
  readonly title: string;
  readonly measures: string;
  readonly calc: string;
  readonly status?: string;
}

const FR = {
  // The tooltip section labels (rendered by InfoTip — dictionary strings,
  // never hardcoded JSX).
  _meta: {
    measures: "Mesure :",
    calc: "Calcul :",
    status: "Statut :",
  },
  viewMode: {
    pilotage: {
      title: "Vue Pilotage Exécutif",
      measures: "Les déclencheurs opérationnels de la direction : vagues de tranches, triage des créances, concentration du risque familial.",
      calc: "Chaque carte dérive les mêmes flux de données de référence que Finances (installments, payments, ledger) via les moteurs canoniques du domaine.",
      status: "L'onglet actif est surligné ; les autres vues restent accessibles sans rechargement.",
    },
    diagnostic: {
      title: "Vue Diagnostic Actif",
      measures: "L'exploration par élève : profils de risque croisés (pédagogique, assiduité, financier) et matrices d'analyse.",
      calc: "Les profils proviennent d'une seule évaluation (evaluateStudentRiskProfiles) partagée par toutes les cartes — jamais recalculée par carte.",
      status: "Une seule évaluation alimente toutes les vues : les compteurs ne peuvent pas diverger entre cartes.",
    },
    charts: {
      title: "Vue Flux Financiers",
      measures: "Les statistiques descriptives des encaissements : méthodes, catégories, comparaison annuelle, vieillissement, Pareto.",
      calc: "Tous les agrégats partent de la tranche filtrée (paiements réglés, dans la période, conformes aux slicers) — la même définition que les KPI.",
      status: "Les filtres actifs (mode/pôle) recalculent instantanément chaque carte de cette vue.",
    },
  },
  header: {
    academicYear: {
      title: "Année active",
      measures: "L'année scolaire de référence de toutes les statistiques de cette page.",
      calc: "Les tranches sont filtrées par fenêtre de facturation (1er sept → 1er sept suivant) — le même périmètre que l'onglet Finances → Tranches.",
      status: "Changer d'année dans le sélecteur recalcule chaque métrique dérivée des tranches.",
    },
  },
  slicers: {
    header: {
      title: "Filtres Dynamiques (Slicers)",
      measures: "Le filtrage croisé de toutes les cartes de paiements de la vue Flux Financiers (sémantique Power BI).",
      calc: "Un slicer actif restreint la tranche aux paiements réglés correspondants ; ensemble vide = aucun filtre (tout inclus).",
      status: "Le badge affiché compte les opérations retenues / total et le montant encaissé filtré.",
    },
    methods: {
      title: "Slicers Mode de paiement",
      measures: "Les méthodes d'encaissement : espèces, chèque, virement.",
      calc: "Le filtrage s'applique au champ payments.method de la tranche déjà restreinte aux paiements réglés dans la période.",
      status: "Un chip surligné = méthode incluse ; plusieurs chips actives s'additionnent (OU logique).",
    },
    categories: {
      title: "Slicers Pôle / Catégorie",
      measures: "Les catégories de facturation (scolarité, transport, cantine, uniforme, livres, psychologie, orthophonie, activités…).",
      calc: "Le filtrage s'applique au champ payments.category ; « Multi-services » (ADR-023) est un chip distinct pour les encaissements globaux.",
      status: "Ensemble vide = toutes catégories ; le chip actif filtre, le chip inactif exclut.",
    },
    badge: {
      title: "Badge d'effectif filtré",
      measures: "Le compte d'opérations retenues sur le total, et le total encaissé de la tranche filtrée.",
      calc: "N paiements retenus / N total (hors filtres) · Σ des montants de la tranche filtrée.",
      status: "Si le compte filtré est inférieur au total, des slicers actifs excluent des opérations.",
    },
    reset: {
      title: "Réinitialiser les filtres",
      measures: "La remise à zéro de tous les slicers (méthodes et catégories).",
      calc: "Remet l'état des filtres à l'ensemble vide — toutes les opérations réglées de la période re-deviennent incluses.",
      status: "Le bouton n'apparaît que lorsqu'au moins un slicer est actif.",
    },
  },
  statStrip: {
    total: {
      title: "Total Encaissé",
      measures: "La somme des encaissements de la tranche filtrée (paiements réglés).",
      calc: "Σ payment.amount sur la tranche — la même définition que la KPI « Encaissé » du tableau de bord.",
    },
    count: {
      title: "Volume Transactions",
      measures: "Le nombre d'opérations (versements) de la tranche filtrée.",
      calc: "Compte des paiements de la tranche ; les chèques/virements non compensés sont exclus (statut ≠ réglé).",
    },
    mean: {
      title: "Panier Moyen",
      measures: "Le montant moyen par opération encaissée.",
      calc: "Σ montants ÷ nombre d'opérations, arrondi au dinar (moyenne arithmétique).",
    },
    median: {
      title: "Médiane",
      measures: "Le montant central de la distribution des encaissements (50 % au-dessus, 50 % en-dessous).",
      calc: "Tri des montants ; valeur centrale, ou moyenne des deux centraux si le compte est pair.",
    },
    bestMonth: {
      title: "Mois Record",
      measures: "Le mois calendaire avec le plus fort encaissement de la tranche.",
      calc: "Agrégation par mois calendaire de collectedAt ; le mois au Σ le plus élevé (étiquette + montant).",
    },
    stdDev: {
      title: "Volatilité (σ)",
      measures: "La dispersion des montants autour du panier moyen.",
      calc: "Écart-type d'échantillon : √( Σ(x − moyenne)² ÷ (n − 1) ), arrondi au dinar. σ faible = montants homogènes (tranches fixes).",
    },
  },
  waveVelocity: {
    card: {
      title: "Vélocité de Recouvrement par Vague",
      measures: "L'analyse T1/T2/T3 TOUTES CATÉGORIES : ce qui a été facturé, encaissé, en cours et reste dû par vague saisonnière.",
      calc: "Chaque carte est le POOL canonique (domain/calc/payment/tranche-waves) de toutes les catégories de la vague — l'EXACT objet que l'onglet Finances → Tranches consomme : parité au dinar près par construction.",
      status: "Clôturée = reste dû nul · En retard = au moins une échéance non soldée dépassée · En cours = le reste.",
    },
    collectedPct: {
      title: "Taux de recouvrement",
      measures: "Le pourcentage du montant facturé déjà encaissé (fonds compensés) sur la vague.",
      calc: "round(Σ amountPaid ÷ Σ amountDue × 100) — convention PARITY-001, jamais plafonné (une vague sur-couverte peut dépasser 100 %).",
      status: "Le code couleur suit le statut de la vague, pas le pourcentage.",
    },
    dossiers: {
      title: "Dossiers (X/Y)",
      measures: "Les engagements soldés sur le total d'engagements de la vague, toutes catégories.",
      calc: "Comptage du prédicat canonique isInstallmentSettled (INV-4) : statut « payé » OU reste dû nul (les fonds en instance couvrent aussi).",
    },
    due: {
      title: "Facturé",
      measures: "Le total facturé de la vague, toutes catégories confondues.",
      calc: "Σ amountDue des lignes de la vague (arrondi par ligne, domaine DZD entier).",
    },
    paid: {
      title: "Encaissé",
      measures: "Les fonds compensés (espèces, chèques/virements débloqués) appliqués à la vague.",
      calc: "Σ amountPaid des lignes de la vague — les fonds en instance (non compensés) sont comptés dans « En cours ».",
    },
    pending: {
      title: "En cours",
      measures: "Les fonds NON compensés posés sur les tranches de la vague (chèques/virements en attente de validation bancaire).",
      calc: "Σ amountPending des lignes de la vague ; la ligne de contrôle de la carte prouve : Facturé = Encaissé + En cours + Reste dû.",
      status: "Ces fonds deviennent « Encaissé » quand le paiement passe réglé, ou sont annulés si le chèque est rejeté.",
    },
    remaining: {
      title: "Reste dû",
      measures: "Le solde encore à recouvrer sur la vague.",
      calc: "Σ INV-4 par ligne : max(0, amountDue − amountPaid − amountPending).",
      status: "Rouge quand > 0 ; une vague à reste dû nul est « Clôturée ».",
    },
    families: {
      title: "Familles (débitrices / totales)",
      measures: "Les familles qui doivent encore sur la vague, sur le total des familles facturées (union des catégories — jamais de double-compte).",
      calc: "Ensemble-union des familles par vague ; le sous-libellé suit la phase : « en retard » (échéance dépassée), « à échoir » (futur), « non soldées ».",
      status: "Rouge = familles en retard réelles ; orange = familles devant mais pas encore échues.",
    },
    categories: {
      title: "Catégories (compteur + chips)",
      measures: "Le nombre de catégories de facturation présentes dans la vague, et leur détail (taux + reste dû par catégorie).",
      calc: "Chips = les lignes canoniques par (catégorie × vague) ; chaque chip : round(encaissé ÷ facturé × 100) et le reste dû compact.",
      status: "La chip rouge signale un reste dû ; les chips prouvent qu'AUCUNE catégorie n'est silencieusement exclue.",
    },
    identity: {
      title: "Ligne de contrôle (réconciliation)",
      measures: "La preuve arithmétique de la carte : Total dû = Encaissé + En cours + Reste dû.",
      calc: "Identité exacte par ligne : due + max(0, payé + en instance − dû) = payé + en instance + reste dû. Le terme « couverts au-delà » n'apparaît que si des fonds excèdent le dû (crédit posé sur la ligne).",
    },
    echeance: {
      title: "Échéance (plage)",
      measures: "La plage de dates d'échéance réelle des lignes de la vague (min → max).",
      calc: "Dérivée des dates des lignes elles-mêmes — jamais du calendrier officiel codé en dur ; « N j de retard » compte les jours depuis l'échéance la plus ancienne non soldée.",
      status: "Rouge = au moins une échéance dépassée ; « dans N j » = vague pas encore due.",
    },
    phase: {
      title: "Statut de la vague",
      measures: "Le verdict de la vague : Clôturée, En retard, ou En cours.",
      calc: "Clôturée = reste dû nul (INV-4) · En retard = au moins une ligne non soldée à échéance dépassée · En cours = le reste.",
      status: "Vert (clôturée) · Rouge (en retard) · Bleu (en cours). Un verdict sans sa cause visible serait indiscernable d'un bug (UI-316).",
    },
    breakdown: {
      title: "Détail par Catégorie de Facturation",
      measures: "La lecture catégorie par catégorie des vagues (scolarité T1, transport T1, etc.).",
      calc: "Les lignes canoniques par (catégorie × tranche 1..3) — le même regroupement dont le pool principal est la somme.",
      status: "« en retard » = cette catégorie précise porte une échéance dépassée non soldée.",
    },
    nonWave: {
      title: "Hors Tranches — FI & engagements non-tranches",
      measures: "Les frais d'inscription (FI) et les engagements hors modèle 3-tranches : « Année complète », échéanciers personnalisés, lignes héritées hors bornes.",
      calc: "Les lignes à tranche 0 (FI), sans numéro ou hors 1..3, regroupées par (type × catégorie) — exclues des vagues PAR CONCEPTION, jamais silencieusement.",
      status: "« soldé » = reste dû nul sur le groupe ; rouge = reste dû ouvert.",
    },
    globalBadges: {
      title: "Badges globaux",
      measures: "Le taux de recouvrement global, les fonds en instance et le reste dû total des trois vagues.",
      calc: "Σ sur les trois vagues du pool canonique : round(encaissé ÷ facturé × 100), Σ en instance (badge info), Σ reste dû (badge rouge).",
    },
  },
  triage: {
    card: {
      title: "Triage des créances",
      measures: "La répartition de l'encours par ancienneté réelle du retard — le triage d'action (relance, intervention).",
      calc: "Chaque tranche non soldée à reste dû > 0 est classée par jours de retard (floor) avec les SEUILS CONFIGURABLES du suivi des dettes (les mêmes que Finances).",
      status: "Les bornes des libellés suivent la configuration (Paramètres) — jamais un seuil codé en dur local.",
    },
    notDue: {
      title: "Non échue",
      measures: "L'encours dont l'échéance n'est pas encore passée (tranches futures — pas une mauvaise dette).",
      calc: "Reste dû INV-4 des lignes à échéance ≥ aujourd'hui.",
      status: "Ce montant explique pourquoi le « Total Dette » brut alarme à tort : il contient l'année entière.",
    },
    current: {
      title: "Retard ≤ seuil jaune (à surveiller)",
      measures: "Le retard transitoire (cycle de salaire) sous le seuil jaune configuré.",
      calc: "Reste dû des lignes avec 0 < jours de retard ≤ yellowDays (défaut 15 j).",
      status: "Couche jaune du statut canonique 4 niveaux.",
    },
    reminder: {
      title: "Retard jaune→rouge (relance)",
      measures: "Le retard soutenu qui justifie une relance active (WhatsApp).",
      calc: "Reste dû des lignes avec yellowDays < jours de retard ≤ redDays (défaut 60 j).",
      status: "Couche orange du statut canonique.",
    },
    chronic: {
      title: "Retard > seuil rouge (intervention)",
      measures: "La dette chronique au-delà du seuil rouge — verrouillage de compte / intervention de la direction.",
      calc: "Reste dû des lignes à jours de retard > redDays.",
      status: "Couche rouge du statut canonique ; alimente la liste d'appel.",
    },
    callList: {
      title: "Liste d'appel",
      measures: "Les familles au-delà du rouge, classées par exposition décroissante.",
      calc: "Familles dont la pire échéance dépasse redDays ; montant = leur encours TOTAL (toutes couches), top 10.",
      status: "L'exposition peut dépasser le seul bucket chronique — c'est l'encours complet de la famille.",
    },
  },
  erosion: {
    card: {
      title: "Taux d'Érosion des Remises",
      measures: "L'impact des concessions tarifaires négociées sur le potentiel de revenu.",
      calc: "Depuis le grand livre : les ajustements de crédit négatifs (remises) sur la base brute facturée ; l'érosion = round(remises ÷ (charges brutes + remises) × 100).",
    },
    count: {
      title: "Remises (nombre)",
      measures: "Le nombre d'ajustements de remise négociés et les familles concernées.",
      calc: "Comptage des écritures type « ajustement » à montant négatif (contrat d'identification T-389 : metadata.field = REMISE).",
    },
    total: {
      title: "Σ Remises",
      measures: "Le montant total des remises accordées.",
      calc: "Σ |montant| des écritures de remise ; le « net » soustrait les annulations de double-remise (réconciliation 0063).",
    },
    net: {
      title: "Remises nettes",
      measures: "Les remises après annulations (netting des devis importés).",
      calc: "Σ remises − Σ annulations (écritures de débit positives appariées).",
    },
    pct: {
      title: "Taux d'érosion",
      measures: "La part du potentiel brut concédée en remises.",
      calc: "round(remises ÷ sticker total × 100) où sticker = charges brutes + remises (les devis importés sont déjà nets).",
    },
    avg: {
      title: "Remise moyenne / max",
      measures: "La remise typique et la plus forte concession.",
      calc: "Moyenne = Σ remises ÷ nombre ; min/max sur les mêmes écritures.",
    },
  },
  concentration: {
    card: {
      title: "Concentration du risque familial",
      measures: "La part de l'encours total portée par le Top 10 des familles (règle 80/20).",
      calc: "Encours par famille = Σ INV-4 sur ses lignes non soldées ; concentration = round(top 10 ÷ total × 100).",
      status: "Une concentration élevée = le non-recouvrement de quelques familles suffirait à creuser le trou.",
    },
    top: {
      title: "Top 10 des familles débitrices",
      measures: "Les familles classées par encours décroissant, avec leurs enfants actifs et leur pire retard.",
      calc: "Encours INV-4 par famille ; « pire retard » = max des jours de retard de leurs lignes.",
    },
    pct: {
      title: "Concentration (%)",
      measures: "La part de l'encours total détenue par le top N.",
      calc: "round(Σ top N ÷ encours total × 100) — 100 % signifierait que tout l'encours tient dans le top N.",
    },
    worst: {
      title: "Pire retard (jours)",
      measures: "L'ancienneté du retard le plus ancien de la famille.",
      calc: "max(floor((maintenant − échéance) ÷ jour)) sur les lignes non soldées de la famille.",
    },
  },
  dynamics: {
    card: {
      title: "Dynamique des effectifs et fratries",
      measures: "La structure de la population scolaire : indice de fratries, tailles de familles, équilibre des sections.",
      calc: "Depuis les élèves ACTIFS : familles = parents distincts d'élèves actifs ; aucune plafond de capacité n'intervient (directive propriétaire).",
    },
    sibling: {
      title: "Indice de fratries",
      measures: "Le multiplicateur familial : combien d'élèves scolarisés par famille en moyenne.",
      calc: "élèves actifs ÷ familles (2 décimales) ; > 1 = les familles inscrivent plusieurs enfants (fidélité).",
    },
    sizes: {
      title: "Tailles de familles",
      measures: "La distribution des familles par nombre d'enfains actifs.",
      calc: "Comptage par taille (1, 2, 3, 4, 5+) sur les élèves actifs.",
    },
    multiChild: {
      title: "Familles multi-enfants",
      measures: "Les familles avec ≥ 2 enfants actifs — le cœur de la fidélité (et du risque de concentration).",
      calc: "Comptage + part de l'ensemble des familles avec enfant actif.",
    },
    imbalance: {
      title: "Déséquilibre des sections",
      measures: "Les niveaux dont les sections parallèles dérivent en effectif.",
      calc: "Par niveau à ≥ 2 sections : écart max−min ; signalé si écart ≥ 10 ou max ≥ 1,5 × min (aucun plafond artificiel).",
      status: "Signalé = candidat à une redistribution (pas une erreur de données).",
    },
  },
  transport: {
    card: {
      title: "Rendement transport",
      measures: "Le recouvrement par ligne de transport (destination normalisée) et le taux de remplissage.",
      calc: "Les lignes transport sont attribuées aux lignes de transport par le parent de l'élève inscrit ; les villes sont normalisées (TOWN_ALIASES).",
    },
    riders: {
      title: "Élèves transportés",
      measures: "Les élèves actifs avec une affectation de transport (et ceux sans).",
      calc: "Comptage des transportTier non nuls normalisés ; « non résolues » = les orthographes de villes inconnues, listées telles quelles.",
    },
    routes: {
      title: "Lignes par destination",
      measures: "Les effectifs et la santé financière par ligne (facturé, encaissé, reste dû).",
      calc: "Σ sur les lignes de transport des familles conductrices de la ligne ; taux = round(encaissé ÷ facturé × 100).",
    },
    unresolved: {
      title: "Valeurs non résolues",
      measures: "Les orthographes de villes non reconnues par le tableau d'alias (données sources à corriger).",
      calc: "Comptage verbatim des transportTier non vides normalisés en « autres » — honnête, jamais silencieux.",
    },
  },
  services: {
    card: {
      title: "Revenus services spécialisés",
      measures: "Les encaissements des services hors scolarité/transport : psychologie, orthophonie, activités, cantine, uniforme, livres, tablier, autres.",
      calc: "Depuis les PAIEMENTS réglés de la période (catégorie du paiement) — la même base que la KPI « Encaissé services » ; les catégories sans activité sont omises (état vide honnête).",
    },
    revenue: {
      title: "Revenu par service",
      measures: "Le total encaissé par catégorie de service sur la période filtrée.",
      calc: "Σ payment.amount des paiements réglés de la catégorie (statut « réglé » uniquement).",
    },
    volume: {
      title: "Volume par service",
      measures: "Le nombre d'opérations et d'élèves distincts servis par catégorie.",
      calc: "Comptage des paiements + ensemble des studentId portés (quand le paiement est attribué à un élève).",
    },
  },
  risk: {
    card: {
      title: "Radar de vigilance multi-critères",
      measures: "La synthèse du triple risque : pédagogique, assiduité, financier — et les élèves en tension sur les trois axes.",
      calc: "Une seule évaluation des profils (evaluateStudentRiskProfiles) : moyenne < 10, absences ≥ 3, dette ouverte ; le compteur triple = les trois à la fois.",
      status: "Chaque compteur est cliquable vers la console pour la liste nominative.",
    },
    academic: {
      title: "Moyenne < 10",
      measures: "Les élèves sous la moyenne de passage (10/20).",
      calc: "Comptage des profils à GPA < 10 (GPA null = pas de notes : exclu, pas compté à zéro).",
    },
    attendance: {
      title: "Absences ≥ 3",
      measures: "Les élèves avec au moins 3 absences enregistrées (justifiées ou non).",
      calc: "Comptage des profils à absences ≥ 3 sur la période du filtre.",
    },
    financial: {
      title: "Dette ouverte",
      measures: "Les élèves dont la famille a un encours ouvert.",
      calc: "Comptage des profils avec encours familial > 0 (INV-4, toutes années).",
    },
  },
  methodMix: {
    card: {
      title: "Mix des méthodes de paiement",
      measures: "La répartition des encaissements par méthode (espèces, chèque, virement).",
      calc: "Σ des montants de la tranche filtrée groupée par payments.method ; parts = round(montant ÷ total × 100).",
    },
    donut: {
      title: "Anneau des méthodes",
      measures: "La part visuelle de chaque méthode ; le centre porte le total.",
      calc: "Les parts sont les mêmes que la liste classée ci-contre (même dérivation).",
    },
  },
  categoryMix: {
    card: {
      title: "Mix des catégories de paiement",
      measures: "Le classement des catégories de facturation par montant encaissé.",
      calc: "Σ par payments.category sur la tranche filtrée ; « Autres (N) » fusionne la queue au-delà du top 6.",
    },
    toggle: {
      title: "Bascule Montant / Opérations",
      measures: "Le classement par montant total ou par nombre d'opérations.",
      calc: "Même dérivation, clé de tri différente (Σ montants vs comptage).",
    },
  },
  yoy: {
    card: {
      title: "Comparaison annuelle des revenus",
      measures: "L'évolution encaissements de cette année scolaire vs la précédente, mois par mois.",
      calc: "Séries du référentiel (revenueForRange) alignées par étiquette de mois ; l'année précédente est chargée pour la même fenêtre décalée d'un an.",
      status: "Δ% = round((actuel − précédent) ÷ précédent × 100) ; nul quand le précédent vaut 0 (pas de tendance sans base).",
    },
    delta: {
      title: "Δ% mensuel",
      measures: "L'écart relatif du mois entre les deux années.",
      calc: "Par mois : round((actuel − précédent) ÷ précédent × 100) — affiché seulement si le précédent > 0.",
    },
    totals: {
      title: "Totaux comparés",
      measures: "Les cumuls des deux années et l'écart global.",
      calc: "Σ des mois affichés par année ; Δ global = round((Σ actuel − Σ précédent) ÷ Σ précédent × 100).",
    },
  },
  aging: {
    card: {
      title: "Vieillissement des créances",
      measures: "La répartition de l'encours non recouvré par ancienneté (0–30, 31–60, 61–90, 91–180, > 180 jours).",
      calc: "Buckets du référentiel (debtByAagingForRange) : chaque tranche non soldée alimente le bucket de ses jours de retard ; la barre empilée = 100 % de l'encours.",
      status: "Plus la bande est à droite, plus le recouvrement devient improbable — > 180 j = dette quasi-perdue.",
    },
    b0_30: {
      title: "0–30 jours",
      measures: "L'encours en retard de moins d'un mois.",
      calc: "Reste dû INV-4 des lignes à 1–30 jours de retard — la couche la plus récupérable.",
    },
    b31_60: {
      title: "31–60 jours",
      measures: "L'encours en retard d'un à deux mois.",
      calc: "Reste dû des lignes à 31–60 jours de retard — relance active.",
    },
    b61_90: {
      title: "61–90 jours",
      measures: "L'encours en retard de deux à trois mois.",
      calc: "Reste dû des lignes à 61–90 jours de retard.",
    },
    b91_180: {
      title: "91–180 jours",
      measures: "L'encours en retard de trois à six mois.",
      calc: "Reste dû des lignes à 91–180 jours de retard — pression forte requise.",
    },
    b180plus: {
      title: "> 180 jours",
      measures: "L'encours au-delà de six mois de retard.",
      calc: "Reste dû des lignes à plus de 180 jours — candidat provision/perte ; alimente le verrouillage des comptes délinquants (> 90 j, Finances → Créances).",
    },
  },
  pareto: {
    card: {
      title: "Pareto des familles débitrices",
      measures: "Le 80/20 : la part de l'encours total portée par les plus grosses familles (toutes années).",
      calc: "Sommaires de dettes du référentiel, classés par encours décroissant ; la courbe cumulée = round(cumulé ÷ total affiché × 100).",
      status: "Si ~20 % des familles portent ~80 % de l'encours, prioriser le recouvrement sur la tête.",
    },
    cum: {
      title: "Courbe cumulée (%)",
      measures: "La part cumulative de l'encours captée en descendant le classement.",
      calc: "Σ glissante des encours ÷ Σ des familles affichées × 100.",
    },
  },
  payroll: {
    card: {
      title: "Coûts du Personnel — Réalisé vs Projeté",
      measures: "La trajectoire des coûts salariaux (réalisé vs projection) et le besoin de financement mensuel.",
      calc: "La projection canonique (computePayrollForecast, ADR-024) — la MÊME que les pages Personnel et Finances : salaires actifs + charges, au fil des mois.",
      status: "Besoin de financement = l'écart entre la projection et l'encaissement attendu du mois.",
    },
    realized: {
      title: "Réalisé",
      measures: "Les coûts salariaux effectivement payés (historique).",
      calc: "Σ des paiements de salaires enregistrés (salaryPayments) par période.",
    },
    funding: {
      title: "Besoin de financement",
      measures: "Le trou de trésorerie projeté du mois (coûts projetés vs recettes attendues).",
      calc: "Projection du mois − encaissements attendus (la même convention que Finances).",
    },
  },
  console: {
    card: {
      title: "Console de requêtes opérationnelles",
      measures: "L'exploration nominative des profils de risque : recherche, filtres, tri, et la fiche 360° par élève.",
      calc: "Les profils sont l'objet partagé unique évalué une fois (jamais recalculé) ; la console filtre/trie ce même objet.",
      status: "Les compteurs de la barre de stats reflètent le filtre courant (dossiers, créances cumulées, moyenne).",
    },
    stats: {
      title: "Barre de statistiques de la console",
      measures: "Dossiers filtrés, créances cumulées de la sélection, moyenne de cohorte.",
      calc: "Comptage/Σ sur les profils filtrés — mêmes définitions que le radar multi-critères.",
    },
  },
  crossRisk: {
    card: {
      title: "Matrice croisée de risque",
      measures: "Le croisement des axes de risque (pédagogie × assiduité, pédagogie × finances, etc.).",
      calc: "Croisement des indicateurs binaires du profil partagé (mêmes seuils que le radar).",
    },
  },
  pivot: {
    card: {
      title: "Matrice pivot pédagogique",
      measures: "La distribution des moyennes par classe/niveau (le pivot pédagogique).",
      calc: "Agrégation des GPA des profils partagés par classe ; les classes vides sont omises (état vide honnête).",
    },
  },
  inspector: {
    card: {
      title: "Inspection directe / provenance des données",
      measures: "Le lien vers l'inspecteur de données : la traçabilité de chaque chiffre jusqu'aux lignes sources.",
      calc: "Chaque déclencheur porte le domaine, la métrique et la valeur source ; l'inspecteur résout la lignée (T-389) — lignes, définition, écarts.",
      status: "« Écart » dans l'inspecteur = un écart de données réel, jamais définitionnel (les deux côtés partagent la dérivation).",
    },
  },
} as const;

/** The FR glossary tree (the reference — see the file header). */
export const STAT_TIPS_FR = FR;

/** The section-label metadata shape (the _meta entries). */
export interface StatsTipMeta {
  readonly measures: string;
  readonly calc: string;
  readonly status: string;
}

/** The glossary tree's shape — the compile-time lock for every locale. */
export type StatsTipDictionary = {
  readonly [K in keyof typeof FR]: K extends "_meta"
    ? StatsTipMeta
    : {
        readonly [E in keyof (typeof FR)[K]]: StatsTipEntry;
      };
};

/** The English glossary tree (the mandate's second language). */
export const STAT_TIPS_EN: StatsTipDictionary = {
  _meta: {
    measures: "Measures:",
    calc: "Calculation:",
    status: "Status:",
  },
  viewMode: {
    pilotage: {
      title: "Executive Steering view",
      measures: "The management's operational triggers: tranche waves, debt triage, family risk concentration.",
      calc: "Every card derives from the SAME repository streams as Finance (installments, payments, ledger) through the canonical domain engines.",
      status: "The active tab is highlighted; the other views remain one click away.",
    },
    diagnostic: {
      title: "Active Diagnostic view",
      measures: "The per-student exploration: crossed risk profiles (academic, attendance, financial) and analysis matrices.",
      calc: "The profiles come from a SINGLE evaluation (evaluateStudentRiskProfiles) shared by every card — never recomputed per card.",
      status: "One evaluation feeds every view: the counters cannot disagree across cards.",
    },
    charts: {
      title: "Financial Flows view",
      measures: "The descriptive statistics of the collections: methods, categories, year-over-year, aging, Pareto.",
      calc: "All aggregates start from the filtered slice (paid payments, in range, matching the slicers) — the same definition as the KPIs.",
      status: "Active filters (method/category) instantly recompute every card in this view.",
    },
  },
  header: {
    academicYear: {
      title: "Active year",
      measures: "The school year every installment-derived statistic on this page refers to.",
      calc: "Installments are scoped to the billing window (Sept 1 → next Sept 1) — the SAME scope as the Finance → Tranches tab.",
      status: "Switching the year recomputes every installment-derived metric.",
    },
  },
  slicers: {
    header: {
      title: "Dynamic Filters (Slicers)",
      measures: "The cross-filtering of every payments card in the Financial Flows view (Power BI semantics).",
      calc: "An active slicer restricts the slice to the matching PAID payments; an empty set = no filter (everything included).",
      status: "The badge counts retained / total operations and the filtered collected total.",
    },
    methods: {
      title: "Payment-method slicers",
      measures: "The collection methods: cash, check, transfer.",
      calc: "Filtering applies to payments.method over the slice already restricted to paid payments in range.",
      status: "A highlighted chip = method included; several active chips add up (logical OR).",
    },
    categories: {
      title: "Category slicers",
      measures: "The billing categories (tuition, transport, canteen, uniform, books, psychology, speech therapy, clubs…).",
      calc: "Filtering applies to payments.category; “Multi-service” (ADR-023) is its own chip for whole-balance collections.",
      status: "An empty set = all categories; the active chip filters, the inactive chip excludes.",
    },
    badge: {
      title: "Filtered count badge",
      measures: "The retained operation count over the total, and the filtered slice's collected total.",
      calc: "N retained payments / N total (without filters) · Σ of the filtered slice's amounts.",
      status: "A retained count below the total means active slicers are excluding operations.",
    },
    reset: {
      title: "Reset the filters",
      measures: "Clearing every slicer (methods and categories).",
      calc: "Restores the empty filter set — every paid operation in range becomes included again.",
      status: "The button only appears when at least one slicer is active.",
    },
  },
  statStrip: {
    total: {
      title: "Total Collected",
      measures: "The sum of the collections in the filtered slice (paid payments).",
      calc: "Σ payment.amount over the slice — the same definition as the dashboard's “Collected” KPI.",
    },
    count: {
      title: "Transaction Volume",
      measures: "The number of operations (installment payments) in the filtered slice.",
      calc: "Count of the slice's payments; uncleared checks/transfers are excluded (status ≠ paid).",
    },
    mean: {
      title: "Average Payment",
      measures: "The average amount per collected operation.",
      calc: "Σ amounts ÷ operation count, rounded to the dinar (arithmetic mean).",
    },
    median: {
      title: "Median",
      measures: "The central amount of the collections distribution (50% above, 50% below).",
      calc: "Amounts sorted; the central value, or the mean of the two central values when the count is even.",
    },
    bestMonth: {
      title: "Record Month",
      measures: "The calendar month with the highest collections in the slice.",
      calc: "Grouping by calendar month of collectedAt; the month with the highest Σ (label + amount).",
    },
    stdDev: {
      title: "Volatility (σ)",
      measures: "The dispersion of the amounts around the average payment.",
      calc: "Sample standard deviation: √( Σ(x − mean)² ÷ (n − 1) ), rounded to the dinar. A low σ = homogeneous amounts (fixed tranches).",
    },
  },
  waveVelocity: {
    card: {
      title: "Collection Velocity per Wave",
      measures: "The ALL-CATEGORY T1/T2/T3 analysis: what was billed, collected, pending and still owed per seasonal wave.",
      calc: "Each card is the canonical POOL (domain/calc/payment/tranche-waves) of every category in the wave — the EXACT object the Finance → Tranches tab consumes: parity to the dinar by construction.",
      status: "Closed = zero remaining · Late = at least one unsettled past-due row · In progress = the rest.",
    },
    collectedPct: {
      title: "Collection rate",
      measures: "The percentage of the billed amount already collected (cleared funds) on the wave.",
      calc: "round(Σ amountPaid ÷ Σ amountDue × 100) — the PARITY-001 convention, never capped (an over-covered wave can exceed 100%).",
      status: "The color follows the wave's status, not the percentage.",
    },
    dossiers: {
      title: "Files (X/Y)",
      measures: "The settled commitments over the wave's total commitments, all categories.",
      calc: "Counting by the canonical isInstallmentSettled predicate (INV-4): status “paid” OR zero remaining (pending funds also cover).",
    },
    due: {
      title: "Billed",
      measures: "The wave's total billed amount across every category.",
      calc: "Σ amountDue of the wave's rows (rounded per row, the integer-DZD domain).",
    },
    paid: {
      title: "Collected",
      measures: "The cleared funds (cash, released checks/transfers) applied to the wave.",
      calc: "Σ amountPaid of the wave's rows — the uncleared (pending) funds are counted in “Pending”.",
    },
    pending: {
      title: "Pending",
      measures: "The UNCLEARED funds sitting on the wave's tranches (checks/transfers awaiting bank clearance).",
      calc: "Σ amountPending of the wave's rows; the card's control line proves: Billed = Collected + Pending + Remaining.",
      status: "These funds become “Collected” when the payment clears, or are voided if the check bounces.",
    },
    remaining: {
      title: "Still owed",
      measures: "The balance still to collect on the wave.",
      calc: "Σ INV-4 per row: max(0, amountDue − amountPaid − amountPending).",
      status: "Red when > 0; a wave with zero remaining is “Closed”.",
    },
    families: {
      title: "Families (owing / total)",
      measures: "The families still owing on the wave, over the total billed families (union across categories — never double-counted).",
      calc: "Set-union of families per wave; the sub-label follows the phase: “late” (past due), “upcoming” (future), “unsettled”.",
      status: "Red = actually-late families; orange = owing but not yet due.",
    },
    categories: {
      title: "Categories (count + chips)",
      measures: "The number of billing categories present in the wave, and their detail (rate + still owed per category).",
      calc: "Chips = the canonical per-(category × wave) rows; each chip: round(collected ÷ billed × 100) and the compact remaining.",
      status: "A red chip signals an outstanding balance; the chips prove NO category is silently excluded.",
    },
    identity: {
      title: "Control line (reconciliation)",
      measures: "The card's arithmetic proof: Total Due = Paid + Pending + Remaining.",
      calc: "Exact identity per row: due + max(0, paid + pending − due) = paid + pending + remaining. The “covered beyond” term appears only when funds exceed the due (credit sitting on the row).",
    },
    echeance: {
      title: "Due date (range)",
      measures: "The wave's rows' actual due-date range (min → max).",
      calc: "Derived from the rows' own dates — never a hardcoded official calendar; “N days late” counts the days since the wave's earliest unsettled due date.",
      status: "Red = at least one past-due date; “in N days” = the wave is not due yet.",
    },
    phase: {
      title: "Wave status",
      measures: "The wave's verdict: Closed, Late, or In progress.",
      calc: "Closed = zero remaining (INV-4) · Late = at least one unsettled row past due · In progress = the rest.",
      status: "Green (closed) · Red (late) · Blue (in progress). A verdict without its visible cause is indistinguishable from a bug (UI-316).",
    },
    breakdown: {
      title: "Per-Category Billing Detail",
      measures: "The category-by-category reading of the waves (tuition T1, transport T1, …).",
      calc: "The canonical per-(category × tranche 1..3) rows — the same grouping the main pool sums.",
      status: "“late” = this precise category carries a past-due unsettled row.",
    },
    nonWave: {
      title: "Outside the Tranches — FI & non-tranche commitments",
      measures: "The registration fees (FI) and the commitments outside the 3-tranche model: “full year”, custom schedules, legacy out-of-range rows.",
      calc: "The rows with tranche 0 (FI), no number, or outside 1..3, grouped by (kind × category) — excluded from the waves BY DESIGN, never silently.",
      status: "“settled” = zero remaining on the group; red = an open balance.",
    },
    globalBadges: {
      title: "Global badges",
      measures: "The global collection rate, the pending funds, and the total still owed across the three waves.",
      calc: "Σ over the three canonical pooled waves: round(collected ÷ billed × 100), Σ pending (info badge), Σ remaining (red badge).",
    },
  },
  triage: {
    card: {
      title: "Debt triage",
      measures: "The outstanding balance split by the real age of the delay — the action triage (reminder, intervention).",
      calc: "Every unsettled row with remaining > 0 is bucketed by days overdue (floored) using the CONFIGURABLE debt-tracking thresholds (the same ones Finance uses).",
      status: "The label bounds follow the configuration (Settings) — never a local hardcoded threshold.",
    },
    notDue: {
      title: "Not due yet",
      measures: "The outstanding balance whose due date has not passed (future tranches — not bad debt).",
      calc: "INV-4 remaining of the rows with due date ≥ today.",
      status: "This amount explains why the raw “Total Debt” alarms wrongly: it contains the whole year.",
    },
    current: {
      title: "Delay ≤ yellow threshold (watch)",
      measures: "The transitory delay (salary cycle) under the configured yellow threshold.",
      calc: "Remaining of the rows with 0 < days overdue ≤ yellowDays (default 15 days).",
      status: "The canonical 4-tier status's yellow layer.",
    },
    reminder: {
      title: "Yellow→red delay (reminder)",
      measures: "The sustained delay justifying an active reminder (WhatsApp).",
      calc: "Remaining of the rows with yellowDays < days overdue ≤ redDays (default 60 days).",
      status: "The canonical status's orange layer.",
    },
    chronic: {
      title: "Delay > red threshold (intervention)",
      measures: "The chronic debt beyond the red threshold — account lock / management intervention.",
      calc: "Remaining of the rows with days overdue > redDays.",
      status: "The canonical status's red layer; feeds the call list.",
    },
    callList: {
      title: "Call list",
      measures: "The families beyond red, ranked by descending exposure.",
      calc: "Families whose worst due date exceeds redDays; the amount = their TOTAL outstanding (every bucket), top 10.",
      status: "The exposure can exceed the chronic bucket alone — it is the family's full balance.",
    },
  },
  erosion: {
    card: {
      title: "Discount Erosion Rate",
      measures: "The impact of the negotiated tariff concessions on the revenue potential.",
      calc: "From the ledger: the negative credit adjustments (discounts) over the gross billed base; erosion = round(discounts ÷ (gross charges + discounts) × 100).",
    },
    count: {
      title: "Discounts (count)",
      measures: "The number of negotiated discount adjustments and the families concerned.",
      calc: "Counting the “adjustment” entries with a negative amount (the T-389 identification contract: metadata.field = REMISE).",
    },
    total: {
      title: "Σ Discounts",
      measures: "The total amount of granted discounts.",
      calc: "Σ |amount| of the discount entries; the “net” subtracts the double-discount cancellations (the 0063 reconciliation).",
    },
    net: {
      title: "Net discounts",
      measures: "The discounts after cancellations (the netting of the imported quotes).",
      calc: "Σ discounts − Σ cancellations (the paired positive debit entries).",
    },
    pct: {
      title: "Erosion rate",
      measures: "The share of the gross potential conceded as discounts.",
      calc: "round(discounts ÷ sticker total × 100) where sticker = gross charges + discounts (the imported quotes are already net).",
    },
    avg: {
      title: "Average / max discount",
      measures: "The typical discount and the largest concession.",
      calc: "Average = Σ discounts ÷ count; min/max over the same entries.",
    },
  },
  concentration: {
    card: {
      title: "Family risk concentration",
      measures: "The share of the total outstanding carried by the top 10 families (the 80/20 rule).",
      calc: "Per-family outstanding = Σ INV-4 over its unsettled rows; concentration = round(top 10 ÷ total × 100).",
      status: "A high concentration = a few families failing to pay would be enough to open the hole.",
    },
    top: {
      title: "Top 10 debtor families",
      measures: "The families ranked by descending outstanding, with their active children and worst delay.",
      calc: "INV-4 outstanding per family; “worst delay” = the max days overdue of their rows.",
    },
    pct: {
      title: "Concentration (%)",
      measures: "The share of the total outstanding held by the top N.",
      calc: "round(Σ top N ÷ total outstanding × 100) — 100% would mean the whole outstanding fits in the top N.",
    },
    worst: {
      title: "Worst delay (days)",
      measures: "The age of the family's oldest delay.",
      calc: "max(floor((now − due) ÷ day)) over the family's unsettled rows.",
    },
  },
  dynamics: {
    card: {
      title: "Enrollment & siblings dynamics",
      measures: "The school population's structure: sibling index, family sizes, section balance.",
      calc: "From the ACTIVE students: families = the distinct parents of active students; no capacity ceiling is involved anywhere (owner directive).",
    },
    sibling: {
      title: "Sibling index",
      measures: "The family multiplier: how many enrolled children per family on average.",
      calc: "active students ÷ families (2 decimals); > 1 = families enroll several children (loyalty).",
    },
    sizes: {
      title: "Family sizes",
      measures: "The distribution of families by number of active children.",
      calc: "Counting by size (1, 2, 3, 4, 5+) over the active students.",
    },
    multiChild: {
      title: "Multi-child families",
      measures: "The families with ≥ 2 active children — the core of loyalty (and of concentration risk).",
      calc: "Count + share of all the families with an active child.",
    },
    imbalance: {
      title: "Section imbalance",
      measures: "The grades whose parallel sections drift apart in headcount.",
      calc: "Per grade with ≥ 2 sections: the max−min spread; flagged when spread ≥ 10 or max ≥ 1.5 × min (no artificial ceiling).",
      status: "Flagged = a redistribution candidate (not a data error).",
    },
  },
  transport: {
    card: {
      title: "Transport yield",
      measures: "The collection per transport route (normalized destination) and the fill rate.",
      calc: "The transport rows are attributed to the routes through the enrolled rider's parent; the towns are normalized (TOWN_ALIASES).",
    },
    riders: {
      title: "Transported students",
      measures: "The active students with a transport assignment (and those without).",
      calc: "Counting the non-null normalized transportTier; “unresolved” = the unknown town spellings, listed verbatim.",
    },
    routes: {
      title: "Routes per destination",
      measures: "The headcounts and the financial health per route (billed, collected, still owed).",
      calc: "Σ over the transport rows of the route's rider families; rate = round(collected ÷ billed × 100).",
    },
    unresolved: {
      title: "Unresolved values",
      measures: "The town spellings the alias table does not recognize (source data to repair).",
      calc: "Verbatim count of the non-empty transportTier values normalized to “other” — honest, never silent.",
    },
  },
  services: {
    card: {
      title: "Specialized-service revenue",
      measures: "The collections of the services beyond tuition/transport: psychology, speech therapy, clubs, canteen, uniform, books, apron, other.",
      calc: "From the period's PAID payments (the payment's category) — the same basis as the “service collections” KPI; inactive categories are omitted (an honest empty state).",
    },
    revenue: {
      title: "Revenue per service",
      measures: "The total collected per service category over the filtered period.",
      calc: "Σ payment.amount of the category's paid payments (“paid” status only).",
    },
    volume: {
      title: "Volume per service",
      measures: "The number of operations and distinct students served per category.",
      calc: "Counting the payments + the set of carried studentIds (when the payment is attributed to a student).",
    },
  },
  risk: {
    card: {
      title: "Multi-criteria vigilance radar",
      measures: "The triple-risk summary: academic, attendance, financial — and the students in tension on all three axes.",
      calc: "A SINGLE evaluation of the profiles (evaluateStudentRiskProfiles): average < 10, absences ≥ 3, open debt; the triple counter = all three at once.",
      status: "Every counter is clickable into the console for the named list.",
    },
    academic: {
      title: "Average < 10",
      measures: "The students below the passing average (10/20).",
      calc: "Counting the profiles with GPA < 10 (a null GPA = no grades: excluded, not counted as zero).",
    },
    attendance: {
      title: "Absences ≥ 3",
      measures: "The students with at least 3 recorded absences (excused or not).",
      calc: "Counting the profiles with absences ≥ 3 over the filter's period.",
    },
    financial: {
      title: "Open debt",
      measures: "The students whose family carries an open balance.",
      calc: "Counting the profiles with a family outstanding > 0 (INV-4, all years).",
    },
  },
  methodMix: {
    card: {
      title: "Payment-method mix",
      measures: "The collections split per method (cash, check, transfer).",
      calc: "Σ of the filtered slice's amounts grouped by payments.method; shares = round(amount ÷ total × 100).",
    },
    donut: {
      title: "Method ring",
      measures: "The visual share of each method; the center carries the total.",
      calc: "The shares are the same as the ranked list beside it (same derivation).",
    },
  },
  categoryMix: {
    card: {
      title: "Payment-category mix",
      measures: "The ranking of the billing categories by collected amount.",
      calc: "Σ per payments.category over the filtered slice; “Other (N)” merges the tail beyond the top 6.",
    },
    toggle: {
      title: "Amount / Operations toggle",
      measures: "The ranking by total amount or by operation count.",
      calc: "Same derivation, a different sort key (Σ amounts vs counting).",
    },
  },
  yoy: {
    card: {
      title: "Year-over-year revenue comparison",
      measures: "The collections evolution of this school year vs the previous one, month by month.",
      calc: "The repository's series (revenueForRange) aligned by month label; the previous year is loaded for the same window shifted back one year.",
      status: "Δ% = round((current − previous) ÷ previous × 100); null when the previous is 0 (no trend without a base).",
    },
    delta: {
      title: "Monthly Δ%",
      measures: "The month's relative gap between the two years.",
      calc: "Per month: round((current − previous) ÷ previous × 100) — displayed only when the previous > 0.",
    },
    totals: {
      title: "Compared totals",
      measures: "The two years' cumulated totals and the overall gap.",
      calc: "Σ of the displayed months per year; global Δ = round((Σ current − Σ previous) ÷ Σ previous × 100).",
    },
  },
  aging: {
    card: {
      title: "Receivables aging",
      measures: "The uncollected outstanding split by age (0–30, 31–60, 61–90, 91–180, > 180 days).",
      calc: "The repository's buckets (debtByAgingForRange): every unsettled row feeds the bucket of its days overdue; the stacked bar = 100% of the outstanding.",
      status: "The further right the band, the less likely the recovery — > 180 days = quasi-lost debt.",
    },
    b0_30: {
      title: "0–30 days",
      measures: "The outstanding less than one month overdue.",
      calc: "INV-4 remaining of the rows 1–30 days overdue — the most recoverable layer.",
    },
    b31_60: {
      title: "31–60 days",
      measures: "The outstanding one to two months overdue.",
      calc: "Remaining of the rows 31–60 days overdue — active reminder.",
    },
    b61_90: {
      title: "61–90 days",
      measures: "The outstanding two to three months overdue.",
      calc: "Remaining of the rows 61–90 days overdue.",
    },
    b91_180: {
      title: "91–180 days",
      measures: "The outstanding three to six months overdue.",
      calc: "Remaining of the rows 91–180 days overdue — strong pressure required.",
    },
    b180plus: {
      title: "> 180 days",
      measures: "The outstanding beyond six months of delay.",
      calc: "Remaining of the rows more than 180 days overdue — a provision/write-off candidate; feeds the delinquent-account lock (> 90 days, Finance → Receivables).",
    },
  },
  pareto: {
    card: {
      title: "Debtor families Pareto",
      measures: "The 80/20: the share of the total outstanding carried by the biggest families (all years).",
      calc: "The repository's debt summaries, ranked by descending outstanding; the cumulative curve = round(cumulated ÷ displayed total × 100).",
      status: "If ~20% of the families carry ~80% of the outstanding, prioritize the head's recovery.",
    },
    cum: {
      title: "Cumulative curve (%)",
      measures: "The cumulative share of the outstanding captured going down the ranking.",
      calc: "Running Σ of the outstanding ÷ Σ of the displayed families × 100.",
    },
  },
  payroll: {
    card: {
      title: "Personnel Costs — Actual vs Projected",
      measures: "The salary-cost trajectory (actual vs projection) and the monthly funding requirement.",
      calc: "The canonical forecast (computePayrollForecast, ADR-024) — the SAME one the Personnel and Finance pages read: active salaries + charges, month by month.",
      status: "Funding requirement = the gap between the projection and the month's expected collections.",
    },
    realized: {
      title: "Actual",
      measures: "The salary costs actually paid (history).",
      calc: "Σ of the recorded salary payments per period.",
    },
    funding: {
      title: "Funding requirement",
      measures: "The month's projected treasury hole (projected costs vs expected receipts).",
      calc: "The month's projection − the expected collections (the same convention as Finance).",
    },
  },
  console: {
    card: {
      title: "Operational query console",
      measures: "The named exploration of the risk profiles: search, filters, sorting, and the per-student 360° sheet.",
      calc: "The profiles are the single shared object evaluated once (never recomputed); the console filters/sorts that same object.",
      status: "The stats bar's counters reflect the current filter (files, cumulated receivables, cohort average).",
    },
    stats: {
      title: "Console stats bar",
      measures: "Filtered files, the selection's cumulated receivables, the cohort average.",
      calc: "Counting/Σ over the filtered profiles — the same definitions as the multi-criteria radar.",
    },
  },
  crossRisk: {
    card: {
      title: "Crossed risk matrix",
      measures: "The crossing of the risk axes (academic × attendance, academic × financial, …).",
      calc: "Crossing the shared profile's binary indicators (the same thresholds as the radar).",
    },
  },
  pivot: {
    card: {
      title: "Academic pivot matrix",
      measures: "The averages' distribution per class/grade (the academic pivot).",
      calc: "Aggregating the shared profiles' GPAs per class; empty classes are omitted (an honest empty state).",
    },
  },
  inspector: {
    card: {
      title: "Direct inspection / data provenance",
      measures: "The link to the data inspector: every number's traceability down to the source rows.",
      calc: "Every trigger carries the domain, the metric and the source value; the inspector resolves the lineage (T-389) — rows, definition, gaps.",
      status: "A “Gap” in the inspector = a real data drift, never a definitional one (both sides share the derivation).",
    },
  },
};

/** The Arabic glossary tree (the i18n parity requirement — all three locales carry the key set). */
export const STAT_TIPS_AR: StatsTipDictionary = {
  _meta: {
    measures: "المقياس:",
    calc: "الحساب:",
    status: "الحالة:",
  },
  viewMode: {
    pilotage: {
      title: "عرض القيادة التنفيذية",
      measures: "مُشغِّلات العمل الإدارية: موجات الدفعات، فرز الديون، تركّز المخاطر العائلية.",
      calc: "كل بطقة تُحسب من نفس مجاري البيانات المرجعية التي تستعملها صفحة المالية عبر المحرّكات المعيارية للمجال.",
      status: "يُبرز التبويب النشط؛ تبقى العروض الأخرى على بُعد نقرة واحدة.",
    },
    diagnostic: {
      title: "عرض التشخيص النشط",
      measures: "الاستكشاف لكل تلميذ: ملفات المخاطر المتقاطعة (دراسية، حضور، مالية) ومصفوفات التحليل.",
      calc: "الملفات تأتي من تقييم واحد (evaluateStudentRiskProfiles) تتشاركه كل البطاقات — لا يُعاد حسابه لكل بطاقة.",
      status: "تقييم واحد يغذّي كل العروض: لا يمكن للعدّادات أن تختلف بين البطاقات.",
    },
    charts: {
      title: "عرض التدفقات المالية",
      measures: "الإحصاءات الوصفية للتحصيلات: الطرق، الفئات، المقارنة السنوية، تقادم الديون، باريتو.",
      calc: "كل المجاميع تنطلق من الشريحة المُرشَّحة (مدفوعات مقاصة، ضمن الفترة، مطابقة للمرشِّحات) — نفس تعريف مؤشرات KPI.",
      status: "المرشِّحات النشطة (طريقة/فئة) تعيد حساب كل بطاقة في هذا العرض فورًا.",
    },
  },
  header: {
    academicYear: {
      title: "السنة النشطة",
      measures: "السنة الدراسية التي تشير إليها كل إحصاءات الدفعات في هذه الصفحة.",
      calc: "تُقيَّد الدفعات بنافذة الفوترة (1 سبتمبر → 1 سبتمبر التالي) — نفس نطاق تبويب المالية → الدفعات.",
      status: "تغيير السنة يعيد حساب كل مقياس مشتق من الدفعات.",
    },
  },
  slicers: {
    header: {
      title: "المرشِّحات الديناميكية",
      measures: "الترشيح المتقاطع لكل بطاقات المدفوعات في عرض التدفقات المالية (دلالات Power BI).",
      calc: "المرشِّح النشط يقصر الشريحة على المدفوعات المقاصة المطابقة؛ المجموعة الفارغة = لا ترشيح (كل شيء مُدرج).",
      status: "يعرض الشارة عدد العمليات المُبقاة/الإجمالي ومجموع التحصيل المُرشَّح.",
    },
    methods: {
      title: "مرشِّحات طريقة الدفع",
      measures: "طرق التحصيل: نقدي، شيك، تحويل.",
      calc: "يُطبَّق الترشيح على payments.method فوق الشريحة المقصورة أصلًا على المدفوعات المقاصة ضمن الفترة.",
      status: "رقاقة مُبرزة = طريقة مُدرجة؛ عدة رقاقات نشطة تُجمع (أو منطقية).",
    },
    categories: {
      title: "مرشِّحات الفئة",
      measures: "فئات الفوترة (دراسة، نقل، مطعم، زيّ، كتب، نفسية، تخاطب، أنشطة…).",
      calc: "يُطبَّق الترشيح على payments.category؛ «متعدد الخدمات» (ADR-023) رقاقة مستقلة للتحصيل الشامل.",
      status: "مجموعة فارغة = كل الفئات؛ الرقاقة النشطة ترشِّح والخاملة تستثني.",
    },
    badge: {
      title: "شارة العدّ المُرشَّح",
      measures: "عدد العمليات المُبقاة من الإجمالي، ومجموع الشريحة المُرشَّحة.",
      calc: "N مدفوعًا مُبقى / N إجمالي (دون مرشِّحات) · Σ مبالغ الشريحة المُرشَّحة.",
      status: "عدد مُبقى أقل من الإجمالي يعني أن مرشِّحات نشطة تستثني عمليات.",
    },
    reset: {
      title: "إعادة تعيين المرشِّحات",
      measures: "تصفير كل المرشِّحات (الطرق والفئات).",
      calc: "يعيد حالة المرشِّحات إلى المجموعة الفارغة — كل عمليات الفترة تعود مُدرجة.",
      status: "يظهر الزر فقط عندما تكون مرشِّحة واحدة على الأقل نشطة.",
    },
  },
  statStrip: {
    total: {
      title: "إجمالي المحصَّل",
      measures: "مجموع تحصيلات الشريحة المُرشَّحة (مدفوعات مقاصة).",
      calc: "Σ payment.amount على الشريحة — نفس تعريف مؤشر «المُحصَّل» في اللوحة.",
    },
    count: {
      title: "حجم المعاملات",
      measures: "عدد العمليات في الشريحة المُرشَّحة.",
      calc: "عدّ مدفوعات الشريحة؛ الشيكات/التحويلات غير المقاصة مستثناة (الحالة ≠ مقاصة).",
    },
    mean: {
      title: "متوسط الدفعة",
      measures: "المبلغ المتوسط لكل عملية محصَّلة.",
      calc: "Σ المبالغ ÷ عدد العمليات، مقرَّبًا للدينار (متوسط حسابي).",
    },
    median: {
      title: "الوسيط",
      measures: "المبلغ المركزي لتوزيع التحصيلات (50% فوق، 50% تحت).",
      calc: "ترتيب المبالغ؛ القيمة المركزية، أو متوسط القيمتين المركزيتين عند تعدد زوجي.",
    },
    bestMonth: {
      title: "الشهر القياسي",
      measures: "الشهر التقويمي الأعلى تحصيلًا في الشريحة.",
      calc: "تجميع حسب الشهر التقويمي لـ collectedAt؛ الشهر ذو الأعلى Σ (تسمية + مبلغ).",
    },
    stdDev: {
      title: "التقلّب (σ)",
      measures: "تشتت المبالغ حول متوسط الدفعة.",
      calc: "الانحراف المعياري للعيّنة: √( Σ(x − المتوسط)² ÷ (n − 1) )، مقرَّبًا للدينار. σ منخفض = مبالغ متجانسة (دفعات ثابتة).",
    },
  },
  waveVelocity: {
    card: {
      title: "سرعة التحصيل حسب الموجة",
      measures: "تحليل T1/T2/T3 لكل الفئات: المُفوتر، المحصَّل، الجاري والمتبقي لكل موجة موسمية.",
      calc: "كل بطاقة هي التجميع المعياري (domain/calc/payment/tranche-waves) لكل فئات الموجة — نفس الكائن الذي يستهلكه تبويب المالية → الدفعات: تطابق حتى الدينار بالبنية.",
      status: "مُقفلة = لا متبقٍ · متأخرة = استحقاق غير مسدَّد مجتاز · جارية = الباقي.",
    },
    collectedPct: {
      title: "نسبة التحصيل",
      measures: "النسبة المئوية للمبلغ المُفوتر المحصَّلة (أموال مقاصة) على الموجة.",
      calc: "round(Σ amountPaid ÷ Σ amountDue × 100) — اصطلاح PARITY-001، بلا سقف (موجة مغطاة زيادة قد تتجاوز 100%).",
      status: "اللون يتبع حالة الموجة لا النسبة.",
    },
    dossiers: {
      title: "الملفات (X/Y)",
      measures: "الالتزامات المسدَّدة من إجمالي التزامات الموجة، كل الفئات.",
      calc: "العدّ بمقياس isInstallmentSettled المعياري (INV-4): حالة «مدفوع» أو متبقٍ صفري (الأموال المعلّقة تغطي أيضًا).",
    },
    due: {
      title: "المُفوتر",
      measures: "إجمالي المُفوتر للموجة عبر كل الفئات.",
      calc: "Σ amountDue لسطور الموجة (مقرَّبًا لكل سطر، مجال الدينار الصحيح).",
    },
    paid: {
      title: "المحصَّل",
      measures: "الأموال المقاصة (نقدي، شيكات/تحويلات محررة) المطبقة على الموجة.",
      calc: "Σ amountPaid لسطور الموجة — الأموال غير المقاصة تُحصى في «الجاري».",
    },
    pending: {
      title: "الجاري",
      measures: "الأموال غير المقاصة الواقعة على دفعات الموجة (شيكات/تحويلات بانتظار المقاصة البنكية).",
      calc: "Σ amountPending لسطور الموجة؛ سطر الضبط يبرهن: المُفوتر = المحصَّل + الجاري + المتبقي.",
      status: "تصبح هذه الأموال «محصَّلة» عند مقاصة الدفعة، أو تُلغى إذا ارتدّ الشيك.",
    },
    remaining: {
      title: "المتبقي",
      measures: "الرصيد الواجب تحصيله بعد على الموجة.",
      calc: "Σ INV-4 لكل سطر: max(0, amountDue − amountPaid − amountPending).",
      status: "أحمر إذا > 0؛ الموجة ذات متبقٍ صفري «مُقفلة».",
    },
    families: {
      title: "العائلات (المدينة/الإجمالي)",
      measures: "العائلات التي لا تزال مدينة على الموجة من إجمالي العائلات المُفوترة (اتحاد الفئات — بلا عدّ مزدوج).",
      calc: "اتحاد-مجموعات العائلات لكل موجة؛ العنوان الفرعي يتبع الطور: «متأخرة» (استحقاق مجتاز)، «قادمة» (مستقبل)، «غير مسدَّدة».",
      status: "أحمر = عائلات متأخرة فعلاً؛ برتقالي = مدينة لكن الاستحقاق لم يحلّ.",
    },
    categories: {
      title: "الفئات (العدّ + الرقاقات)",
      measures: "عدد فئات الفوترة الحاضرة في الموجة، وتفصيلها (النسبة والمتبقي لكل فئة).",
      calc: "الرقاقات = السطور المعيارية لكل (فئة × موجة)؛ كل رقاقة: round(محصَّل ÷ مفوتر × 100) والمتبقي المختصر.",
      status: "الرقاقة الحمراء تدل على متبقٍ؛ الرقاقات تبرهن أن لا فئة تُستثنى بصمت.",
    },
    identity: {
      title: "سطر الضبط (التسوية)",
      measures: "البرهان الحسابي للبطاقة: الإجمالي الواجب = المحصَّل + الجاري + المتبقي.",
      calc: "متساوية دقيقة لكل سطر: المستحق + max(0, مدفوع + معلّق − مستحق) = مدفوع + معلّق + متبقٍ. يظهر حدّ «مغطى زيادة» فقط إذا فاقت الأموال الاستحقاق.",
    },
    echeance: {
      title: "الاستحقاق (المدى)",
      measures: "مدى تواريخ الاستحقاق الفعلية لسطور الموجة (الأدنى → الأقصى).",
      calc: "مشتق من تواريخ السطور نفسها — أبدًا لا من تقويم رسمي مُشفَّر؛ «N يوم تأخير» يعدّ الأيام منذ أقدم استحقاق غير مسدَّد.",
      status: "أحمر = استحقاق مجتاز واحد على الأقل؛ «خلال N يوم» = الموجة لم تُستحق بعد.",
    },
    phase: {
      title: "حالة الموجة",
      measures: "حكم الموجة: مُقفلة، متأخرة، أو جارية.",
      calc: "مُقفلة = متبقٍ صفري (INV-4) · متأخرة = سطر غير مسدَّد مجتاز الاستحقاق واحد على الأقل · جارية = الباقي.",
      status: "أخضر (مُقفلة) · أحمر (متأخرة) · أزرق (جارية). حكم بلا سببه المرئي لا يُميَّز عن الخلل (UI-316).",
    },
    breakdown: {
      title: "تفصيل حسب فئة الفوترة",
      measures: "القراءة فئة-بفئة للموجات (دراسة T1، نقل T1…).",
      calc: "السطور المعيارية لكل (فئة × دفعة 1..3) — نفس التجميع الذي تجمعه الموجة الرئيسية.",
      status: "«متأخرة» = هذه الفئة تحديدًا تحمل استحقاقًا مجتازًا غير مسدَّد.",
    },
    nonWave: {
      title: "خارج الدفعات — FI والالتزامات غير المجزَّأة",
      measures: "رسوم التسجيل (FI) والالتزامات خارج نموذج الدفعات الثلاث: «سنة كاملة»، جداول مخصصة، سطور قديمة خارج الحدود.",
      calc: "السطور ذات الدفعة 0 (FI) أو بلا رقم أو خارج 1..3، مجمَّعة حسب (النوع × الفئة) — مستثناة من الموجات عمدًا، لا بصمت.",
      status: "«مسدَّد» = متبقٍ صفري على المجموعة؛ أحمر = رصيد مفتوح.",
    },
    globalBadges: {
      title: "الشارات الإجمالية",
      measures: "نسبة التحصيل الإجمالية والأموال المعلّقة والمتبقي الكلي للموجات الثلاث.",
      calc: "Σ على الموجات الثلاث المجمعية المعيارية: round(محصَّل ÷ مفوتر × 100)، Σ جارٍ (شارة معلومات)، Σ متبقٍ (شارة حمراء).",
    },
  },
  triage: {
    card: {
      title: "فرز الديون",
      measures: "توزيع الرصيد حسب العمر الحقيقي للتأخير — فرز العمل (تذكير، تدخّل).",
      calc: "كل سطر غير مسدَّد بمتبقٍ > 0 يُصنَّف حسب أيام التأخير (floor) بالعتبات القابلة للتهيئة لتتبّع الديون (نفس عتبات المالية).",
      status: "تتبع حدود التسميات الإعدادات (الإعدادات) — أبدًا لا عتبة محلية مُشفَّرة.",
    },
    notDue: {
      title: "غير مستحقة بعد",
      measures: "الرصيد الذي لم يحلّ استحقاقه بعد (دفعات مستقبلية — ليست ديونًا سيئة).",
      calc: "متبقٍ INV-4 للسطور باستحقاق ≥ اليوم.",
      status: "هذا المبلغ يفسّر لماذا ينذِر «إجمالي الدين» الخام زورًا: يحتوي السنة كلها.",
    },
    current: {
      title: "تأخير ≤ عتبة صفراء (مراقبة)",
      measures: "التأخير العابر (دورة الراتب) تحت العتبة الصفراء المُهيَّأة.",
      calc: "متبقي السطور بـ 0 < أيام تأخير ≤ yellowDays (الافتراضي 15 يومًا).",
      status: "طبقة الحالة المعيارية الرباعية الصفراء.",
    },
    reminder: {
      title: "تأخير أصفر→أحمر (تذكير)",
      measures: "التأخير المتواصل المبرِّر لتذكير نشط (WhatsApp).",
      calc: "متبقي السطور بـ yellowDays < أيام تأخير ≤ redDays (الافتراضي 60 يومًا).",
      status: "طبقة الحالة المعيارية البرتقالية.",
    },
    chronic: {
      title: "تأخير > العتبة الحمراء (تدخّل)",
      measures: "الدين المزمن فوق العتبة الحمراء — قفل حساب/تدخّل الإدارة.",
      calc: "متبقي السطور بأيام تأخير > redDays.",
      status: "طبقة الحالة الحمراء؛ تغذّي قائمة الاتصال.",
    },
    callList: {
      title: "قائمة الاتصال",
      measures: "العائلات فوق الأحمر، مرتبة تنازليًا بالانكشاف.",
      calc: "العائلات التي يتجاوز أسوأ استحقاق لها redDays؛ المبلغ = رصيدها الكامل (كل الطبقات)، أفضل 10.",
      status: "قد يتجاوز الانكشاف طبقة المزمن وحدها — هو الرصيد الكامل للعائلة.",
    },
  },
  erosion: {
    card: {
      title: "معدل تآكل التخفيضات",
      measures: "أثر التنازلات السعرية المتفاوض عليها في إيرادات محتملة.",
      calc: "من دفتر الأستاذ: تسويات الدائن السالبة (التخفيضات) على القاعدة الإجمالية المُفوترة؛ التآكل = round(تخفيضات ÷ (شحنات إجمالية + تخفيضات) × 100).",
    },
    count: {
      title: "التخفيضات (العدد)",
      measures: "عدد تسويات التخفيض المتفاوض عليها والعائلات المعنية.",
      calc: "عدّ قيود «تسوية» بمبلغ سالب (عقد التعرّف T-389: metadata.field = REMISE).",
    },
    total: {
      title: "Σ التخفيضات",
      measures: "المبلغ الإجمالي للتخفيضات الممنوحة.",
      calc: "Σ |المبلغ| لقيود التخفيض؛ «الصافي» يطرح إلغاءات التخفيض المزدوج (تسوية 0063).",
    },
    net: {
      title: "تخفيضات صافية",
      measures: "التخفيضات بعد الإلغاءات (تصفية العروض المستوردة).",
      calc: "Σ تخفيضات − Σ إلغاءات (قيود مدينة موجبة مقترنة).",
    },
    pct: {
      title: "معدل التآكل",
      measures: "نسبة الاحتمال الإجمالي المتنازَل عنها كتخفيضات.",
      calc: "round(تخفيضات ÷ إجمالي الملصق × 100) حيث الملصق = الشحنات الإجمالية + التخفيضات (العروض المستوردة صافية أصلًا).",
    },
    avg: {
      title: "متوسط / أقصى تخفيض",
      measures: "التخفيض النمطي وأكبر تنازل.",
      calc: "المتوسط = Σ تخفيضات ÷ العدد؛ الأدنى/الأقصى على نفس القيود.",
    },
  },
  concentration: {
    card: {
      title: "تركّز المخاطر العائلية",
      measures: "نسبة الرصيد الإجمالي التي يحملها أفضل 10 عائلات (قاعدة 80/20).",
      calc: "الرصيد لكل عائلة = Σ INV-4 على سطورها غير المسدَّدة؛ التركّز = round(أفضل 10 ÷ الإجمالي × 100).",
      status: "تركّز مرتفع = يكفي إخفاق بعض العائلات في السداد لفتح الثغرة.",
    },
    top: {
      title: "أفضل 10 عائلات مدينة",
      measures: "العائلات مرتبة تنازليًا بالرصيد، مع أبنائها النشطين وأسوأ تأخير.",
      calc: "رصيد INV-4 لكل عائلة؛ «أسوأ تأخير» = أقصى أيام تأخير سطورها.",
    },
    pct: {
      title: "التركّز (%)",
      measures: "نسبة الرصيد الإجمالي التي يحملها أفضل N.",
      calc: "round(Σ أفضل N ÷ الرصيد الإجمالي × 100) — 100% تعني أن كل الرصيد في أفضل N.",
    },
    worst: {
      title: "أسوأ تأخير (أيام)",
      measures: "عمر أقدم تأخير للعائلة.",
      calc: "max(floor((الآن − الاستحقاق) ÷ يوم)) على سطورها غير المسدَّدة.",
    },
  },
  dynamics: {
    card: {
      title: "دينامية الأعداد والأشقاء",
      measures: "بنية المجتمع المدرسي: دليل الأشقاء، أحجام العائلات، توازن الأقسام.",
      calc: "من التلاميذ النشطين: العائلات = الأولياء المميزون لتلاميذ نشطين؛ لا سقف سعة يتدخّل (توجيه المالك).",
    },
    sibling: {
      title: "دليل الأشقاء",
      measures: "المضاعف العائلي: كم تلميذًا مسجَّلًا لكل عائلة في المتوسط.",
      calc: "تلاميذ نشطون ÷ عائلات (منزلتان عشريتان)؛ > 1 = العائلات تسجّل عدة أبناء (ولاء).",
    },
    sizes: {
      title: "أحجام العائلات",
      measures: "توزيع العائلات حسب عدد الأبناء النشطين.",
      calc: "العدّ حسب الحجم (1، 2، 3، 4، 5+) على التلاميذ النشطين.",
    },
    multiChild: {
      title: "عائلات متعددة الأبناء",
      measures: "العائلات بـ ≥ 2 ابن نشط — جوهر الولاء (ومخاطر التركّز).",
      calc: "العدّ + النسبة من عائلات لها ابن نشط.",
    },
    imbalance: {
      title: "اختلال الأقسام",
      measures: "المستويات التي تنحرف أقسامها المتوازية في العدد.",
      calc: "لكل مستوى بـ ≥ قسمين: الفارق الأقصى−الأدنى؛ يُعلَّم إذا كان الفارق ≥ 10 أو الأقصى ≥ 1.5 × الأدنى (لا سقف اصطناعي).",
      status: "مُعلَّم = مرشَّح لإعادة توزيع (لا خطأ بيانات).",
    },
  },
  transport: {
    card: {
      title: "غلة النقل",
      measures: "التحصيل حسب خط النقل (وجهة معيارية) ومعدل الامتلاء.",
      calc: "تُنسب سطور النقل إلى الخطوط عبر ولي التلميذ المسجَّل؛ تُطبَّع المدن (TOWN_ALIASES).",
    },
    riders: {
      title: "التلاميذ المنقولون",
      measures: "التلاميذ النشطون بتكليف نقل (ومن لا تكليف لهم).",
      calc: "عدّ transportTier غير الصفري المُطبَّع؛ «غير محلولة» = هجاءات مدن مجهولة، مُدرجة كما هي.",
    },
    routes: {
      title: "الخطوط حسب الوجهة",
      measures: "الأعداد والصحة المالية لكل خط (مُفوتر، محصَّل، متبقٍ).",
      calc: "Σ على سطور النقل لعائلات راكبي الخط؛ النسبة = round(محصَّل ÷ مفوتر × 100).",
    },
    unresolved: {
      title: "قيم غير محلولة",
      measures: "هجاءات المدن التي لا يتعرّف عليها جدول الأسماء المستعارة (بيانات مصدر يجب إصلاحها).",
      calc: "عدّ حرفي لقيم transportTier غير الفارغة المُطبَّعة إلى «أخرى» — صادق، لا صامت.",
    },
  },
  services: {
    card: {
      title: "إيرادات الخدمات المتخصصة",
      measures: "تحصيلات الخدمات غير الدراسة/النقل: نفسية، تخاطب، أنشطة، مطعم، زيّ، كتب، مئزر، أخرى.",
      calc: "من المدفوعات المقاصة للفترة (فئة الدفعة) — نفس أساس مؤشر «تحصيلات الخدمات»؛ الفئات الخاملة تُحذف (حالة فارغة صادقة).",
    },
    revenue: {
      title: "الإيراد لكل خدمة",
      measures: "المحصَّل الإجمالي لكل فئة خدمة على الفترة المُرشَّحة.",
      calc: "Σ payment.amount لمدفوعات الفئة (حالة «مقاصة» فقط).",
    },
    volume: {
      title: "الحجم لكل خدمة",
      measures: "عدد العمليات والتلاميذ المميزين المخدومين لكل فئة.",
      calc: "عدّ المدفوعات + مجموعة studentId المحمولة (عند نسبة الدفعة لتلميذ).",
    },
  },
  risk: {
    card: {
      title: "رادار اليقظة متعدد المعايير",
      measures: "خلاصة الخطر الثلاثي: دراسي، حضور، مالي — والتلاميذ في توتر على المحاور الثلاثة.",
      calc: "تقييم وحيد للملفات (evaluateStudentRiskProfiles): متوسط < 10، غياب ≥ 3، دين مفتوح؛ العدّ الثلاثي = الثلاثة معًا.",
      status: "كل عدّاد قابل للنقر إلى وحدة التحكم للقائمة الاسمية.",
    },
    academic: {
      title: "المتوسط < 10",
      measures: "التلاميذ دون معدل النجاح (10/20).",
      calc: "عدّ الملفات بمعدل < 10 (معدل فارغ = لا درجات: مستثنى لا مُحصى صفرًا).",
    },
    attendance: {
      title: "غياب ≥ 3",
      measures: "التلاميذ بثلاث غيابات مسجَّلة على الأقل (مبرَّرة أو لا).",
      calc: "عدّ الملفات بغياب ≥ 3 على فترة المرشِّح.",
    },
    financial: {
      title: "دين مفتوح",
      measures: "التلاميذ الذين لعائلاتهم رصيد مفتوح.",
      calc: "عدّ الملفات برصيد عائلي > 0 (INV-4، كل السنوات).",
    },
  },
  methodMix: {
    card: {
      title: "مزيج طرق الدفع",
      measures: "توزيع التحصيلات حسب الطريقة (نقدي، شيك، تحويل).",
      calc: "Σ مبالغ الشريحة المُرشَّحة مجمَّعة حسب payments.method؛ الحصص = round(مبلغ ÷ إجمالي × 100).",
    },
    donut: {
      title: "حلقة الطرق",
      measures: "الحصة البصرية لكل طريقة؛ المركز يحمل الإجمالي.",
      calc: "الحصص نفسها كالقائمة المرتبة جانبها (نفس الاشتقاق).",
    },
  },
  categoryMix: {
    card: {
      title: "مزيج فئات الدفع",
      measures: "ترتيب فئات الفوترة حسب المبلغ المحصَّل.",
      calc: "Σ لكل payments.method على الشريحة؛ «أخرى (N)» يدمج الذيل بعد أفضل 6.",
    },
    toggle: {
      title: "مفتاح المبلغ/العمليات",
      measures: "الترتيب بالمبلغ الإجمالي أو بعدد العمليات.",
      calc: "نفس الاشتقاق بمفتاح ترتيب مختلف (Σ مبالغ مقابل عدّ).",
    },
  },
  yoy: {
    card: {
      title: "مقارنة الإيرادات السنوية",
      measures: "تطور التحصيلات هذه السنة مقابل السابقة، شهرًا بشهر.",
      calc: "سلاسل المستودع (revenueForRange) محاذاةً بتسمية الشهر؛ السنة السابقة محمَّلة لنفس النافذة مزاحة سنة.",
      status: "Δ% = round((الحالي − السابق) ÷ السابق × 100)؛ فارغ عند صفر السابق (لا اتجاه بلا أساس).",
    },
    delta: {
      title: "Δ% الشهري",
      measures: "الفارق النسبي للشهر بين السنتين.",
      calc: "لكل شهر: round((الحالي − السابق) ÷ السابق × 100) — يُعرض فقط إذا السابق > 0.",
    },
    totals: {
      title: "الإجماليات المتقارنة",
      measures: "مجموعتا السنتين والفارق الكلي.",
      calc: "Σ الأشهر المعروضة لكل سنة؛ Δ الكلي = round((Σ الحالي − Σ السابق) ÷ Σ السابق × 100).",
    },
  },
  aging: {
    card: {
      title: "تقادم الديون",
      measures: "توزيع الرصيد غير المحصَّل حسب العمر (0–30، 31–60، 61–90، 91–180، > 180 يومًا).",
      calc: "دلاء المستودع (debtByAgingForRange): كل سطر غير مسدَّد يغذّي دلو أيام تأخيره؛ الشريط المركَّب = 100% من الرصيد.",
      status: "كلما اتجه الشريط يمينًا قلّ احتمال التحصيل — > 180 يومًا = دين شبه مفقود.",
    },
    b0_30: {
      title: "0–30 يومًا",
      measures: "الرصيد المتأخر أقل من شهر.",
      calc: "متبقٍ INV-4 للسطور بتأخير 1–30 يومًا — الطبقة الأكثر قابلية للاسترداد.",
    },
    b31_60: {
      title: "31–60 يومًا",
      measures: "الرصيد المتأخر شهرًا إلى شهرين.",
      calc: "متبقي السطور بتأخير 31–60 يومًا — تذكير نشط.",
    },
    b61_90: {
      title: "61–90 يومًا",
      measures: "الرصيد المتأخر شهرين إلى ثلاثة.",
      calc: "متبقي السطور بتأخير 61–90 يومًا.",
    },
    b91_180: {
      title: "91–180 يومًا",
      measures: "الرصيد المتأخر ثلاثة إلى ستة أشهر.",
      calc: "متبقي السطور بتأخير 91–180 يومًا — ضغط قوي مطلوب.",
    },
    b180plus: {
      title: "> 180 يومًا",
      measures: "الرصيد بستة أشهر تأخير وأكثر.",
      calc: "متبقي السطور بأكثر من 180 يومًا — مرشَّح مخصص/خسارة؛ يغذّي قفل الحسابات المتخلّفة (> 90 يومًا، المالية → الذمم).",
    },
  },
  pareto: {
    card: {
      title: "باريتو العائلات المدينة",
      measures: "الـ 80/20: نسبة الرصيد الكلي التي تحملها أكبر العائلات (كل السنوات).",
      calc: "خلاصات ديون المستودع مرتبة تنازليًا؛ المنحنى التراكمي = round(المتراكم ÷ الإجمالي المعروض × 100).",
      status: "إذا حمل ~20% من العائلات ~80% من الرصيد، فأولوية التحصيل على الرأس.",
    },
    cum: {
      title: "المنحنى التراكمي (%)",
      measures: "الحصة التراكمية للرصيد المُلتقطة نزولًا في الترتيب.",
      calc: "Σ جارٍ للرصيد ÷ Σ العائلات المعروضة × 100.",
    },
  },
  payroll: {
    card: {
      title: "تكاليف الموظفين — المحقَّق مقابل المتوقع",
      measures: "مسار التكاليف salary (المحقَّق مقابل التوقع) والحاجة التمويلية الشهرية.",
      calc: "التوقع المعياري (computePayrollForecast، ADR-024) — نفسه الذي تقرؤه صفحتا الموظفين والمالية.",
      status: "الحاجة التمويلية = الفارق بين التوقع والتحصيل المتوقع للشهر.",
    },
    realized: {
      title: "المحقَّق",
      measures: "التكاليف المدفوعة فعليًا (التاريخ).",
      calc: "Σ مدفوعات الرواتب المسجَّلة لكل فترة.",
    },
    funding: {
      title: "الحاجة التمويلية",
      measures: "ثقب الخزينة المتوقع للشهر (تكاليف متوقعة مقابل إيرادات منتظرة).",
      calc: "توقع الشهر − التحصيلات المنتظرة (نفس اصطلاح المالية).",
    },
  },
  console: {
    card: {
      title: "وحدة استعلامات العمليات",
      measures: "الاستكشاف الاسمي لملفات المخاطر: بحث، مرشِّحات، ترتيب، وملف 360° لكل تلميذ.",
      calc: "الملفات هي الكائن المشترك الوحيد المقيَّم مرة (لا يُعاد)؛ الوحدة ترشِّح/ترتّب نفس الكائن.",
      status: "تعكس عدّادات شريط الإحصاء المرشِّح الحالي (ملفات، ذمم تراكمية، متوسط).",
    },
    stats: {
      title: "شريط إحصاء الوحدة",
      measures: "الملفات المُرشَّحة، الذمم التراكمية للتحديد، متوسط الدفعة.",
      calc: "عدّ/Σ على الملفات المُرشَّحة — نفس تعريفات الرادار متعدد المعايير.",
    },
  },
  crossRisk: {
    card: {
      title: "مصفوفة المخاطر المتقاطعة",
      measures: "تقاطع محاور الخطر (دراسي × حضور، دراسي × مالي…).",
      calc: "تقاطع مؤشرات الملف المشترك الثنائية (نفس عتبات الرادار).",
    },
  },
  pivot: {
    card: {
      title: "مصفوفة المحور الدراسي",
      measures: "توزيع المعدلات حسب الصف/المستوى (المحور الدراسي).",
      calc: "تجميع معدلات الملفات المشتركة حسب الصف؛ الصفوف الفارغة تُحذف (حالة فارغة صادقة).",
    },
  },
  inspector: {
    card: {
      title: "الفحص المباشر / مصدر البيانات",
      measures: "الرابط إلى مفتّش البيانات: تتبع كل رقم حتى السطور المصدر.",
      calc: "كل مُطلِق يحمل المجال والمقياس والقيمة المصدر؛ المفتّش يحل السلالة (T-389) — سطور، تعريف، فوارق.",
      status: "«الفارق» في المفتّش = انزياح بيانات حقيقي، لا تعريفي أبدًا (الطرفان يتشاركان الاشتقاق).",
    },
  },
};
