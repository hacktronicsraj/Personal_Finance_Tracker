package com.personal.financenative.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.personal.financenative.capture.ShareBus
import com.personal.financenative.data.FinanceRepository
import com.personal.financenative.focus.FocusController
import com.personal.financenative.ui.screens.ActivityScreen
import com.personal.financenative.ui.screens.ActivityViewModel
import com.personal.financenative.ui.screens.AddSpendScreen
import com.personal.financenative.ui.screens.AddSpendViewModel
import com.personal.financenative.ui.screens.AskScreen
import com.personal.financenative.ui.screens.AskViewModel
import com.personal.financenative.ui.screens.ClipboardScreen
import com.personal.financenative.ui.screens.ClipboardViewModel
import com.personal.financenative.ui.screens.FocusScreen
import com.personal.financenative.ui.screens.HomeScreen
import com.personal.financenative.ui.screens.InstagramHistoryScreen
import com.personal.financenative.ui.screens.HomeViewModel
import com.personal.financenative.ui.screens.InsightsScreen
import com.personal.financenative.ui.screens.InsightsViewModel
import com.personal.financenative.ui.screens.ReconcileScreen
import com.personal.financenative.ui.screens.ReconcileViewModel
import com.personal.financenative.ui.screens.SettingsScreen
import com.personal.financenative.ui.screens.StatementImportScreen
import com.personal.financenative.ui.screens.TransactionDetailScreen
import com.personal.financenative.ui.screens.TransactionDetailViewModel
import com.personal.financenative.ui.screens.UsageScreen
import com.personal.financenative.ui.theme.Tokens

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val TABS = listOf(
    Tab("home", "Home", Icons.Outlined.GridView),
    Tab("activity", "Activity", Icons.Outlined.Receipt),
    Tab("insights", "Insights", Icons.Outlined.BarChart),
    Tab("focus", "Focus", Icons.Outlined.Shield),
    Tab("clipboard", "Clipboard", Icons.Outlined.ContentPaste),
    Tab("settings", "Settings", Icons.Outlined.Settings),
)

@Composable
fun AppScaffold(repo: FinanceRepository) {
    val nav = rememberNavController()
    val context = LocalContext.current
    val controller = remember { FocusController(context) }
    val backStack by nav.currentBackStackEntryAsState()
    val current = backStack?.destination
    val onTab = current?.route in TABS.map { it.route }

    // A shared payment text → log a spend.
    val paymentText by ShareBus.paymentText.collectAsStateWithLifecycle()
    LaunchedEffect(paymentText) {
        if (paymentText != null) { nav.navigate("add"); ShareBus.consumePayment() }
    }
    // A shared statement PDF, or the weekly reminder tap → the reconcile flow.
    val pdfUri by ShareBus.pdfUri.collectAsStateWithLifecycle()
    LaunchedEffect(pdfUri) { if (pdfUri != null) nav.navigate("statement_import") }
    val openStatement by ShareBus.openStatement.collectAsStateWithLifecycle()
    LaunchedEffect(openStatement) {
        if (openStatement) { nav.navigate("statement_import"); ShareBus.consumeOpenStatement() }
    }

    Scaffold(
        containerColor = Tokens.Bg,
        bottomBar = {
            if (onTab) NavigationBar(containerColor = Tokens.Bg) {
                TABS.forEach { tab ->
                    val selected = current?.hierarchy?.any { it.route == tab.route } == true
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            nav.navigate(tab.route) {
                                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Tokens.Accent,
                            selectedTextColor = Tokens.Accent,
                            unselectedIconColor = Tokens.Muted,
                            unselectedTextColor = Tokens.Muted,
                            indicatorColor = Tokens.AccentDim,
                        ),
                    )
                }
            }
        },
        floatingActionButton = {
            if (onTab) FloatingActionButton(
                onClick = { nav.navigate("add") },
                containerColor = Tokens.Text,
                contentColor = Tokens.Bg,
            ) { Icon(Icons.Outlined.Add, contentDescription = "Add spend") }
        },
    ) { pad ->
        NavHost(
            navController = nav,
            startDestination = "home",
            modifier = Modifier.padding(pad),
        ) {
            composable("home") {
                val vm: HomeViewModel = viewModel(factory = viewModelFactory { initializer { HomeViewModel(repo) } })
                HomeScreen(
                    vm,
                    onSeeAll = { nav.navigate("activity") },
                    onTxn = { id -> nav.navigate("txn/$id") },
                    onAsk = { nav.navigate("ask") },
                )
            }
            composable("activity") {
                val vm: ActivityViewModel = viewModel(factory = viewModelFactory { initializer { ActivityViewModel(repo) } })
                ActivityScreen(vm, onTxn = { id -> nav.navigate("txn/$id") })
            }
            composable("insights") {
                val vm: InsightsViewModel = viewModel(factory = viewModelFactory { initializer { InsightsViewModel(repo) } })
                InsightsScreen(vm)
            }
            composable("focus") {
                FocusScreen(controller, repo, onOpenUsage = { nav.navigate("usage") }, onOpenHistory = { nav.navigate("ig_history") })
            }
            composable("clipboard") {
                val vm: ClipboardViewModel = viewModel(factory = viewModelFactory { initializer { ClipboardViewModel(repo, context) } })
                ClipboardScreen(vm)
            }
            composable("settings") { SettingsScreen(repo, onReconcileStatement = { nav.navigate("statement_import") }) }
            composable("ig_history") { InstagramHistoryScreen(repo, onBack = { nav.popBackStack() }) }
            composable("usage") { UsageScreen(controller, onBack = { nav.popBackStack() }) }
            composable("statement_import") {
                StatementImportScreen(
                    repo,
                    incomingUri = ShareBus.pdfUri.value,
                    onReconcile = { id ->
                        ShareBus.consumePdf()
                        nav.navigate("reconcile/$id") { popUpTo("statement_import") { inclusive = true } }
                    },
                    onCancel = { ShareBus.consumePdf(); nav.popBackStack() },
                )
            }
            composable("reconcile/{id}") { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                val vm: ReconcileViewModel = viewModel(factory = viewModelFactory { initializer { ReconcileViewModel(repo, id) } })
                ReconcileScreen(vm, onDone = { nav.navigate("activity") { popUpTo("home") } }, onBack = { nav.popBackStack() })
            }
            composable("ask") {
                val vm: AskViewModel = viewModel(factory = viewModelFactory { initializer { AskViewModel(repo) } })
                AskScreen(vm, onBack = { nav.popBackStack() })
            }
            composable("add") {
                val vm: AddSpendViewModel = viewModel(factory = viewModelFactory { initializer { AddSpendViewModel(repo) } })
                AddSpendScreen(vm, onDone = { nav.popBackStack() }, onCancel = { nav.popBackStack() })
            }
            composable("txn/{id}") { entry ->
                val id = entry.arguments?.getString("id").orEmpty()
                val vm: TransactionDetailViewModel = viewModel(factory = viewModelFactory { initializer { TransactionDetailViewModel(repo, id) } })
                TransactionDetailScreen(vm, onBack = { nav.popBackStack() })
            }
        }
    }
}
