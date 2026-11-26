import SwiftUI

@main
struct FairyApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var link: LinkClient
    @State private var tabs: TabState
    @Environment(\.scenePhase) private var phase

    init() {
        _link = State(initialValue: AppParts.shared.link)
        _tabs = State(initialValue: AppParts.shared.tabs)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(link)
                .environment(tabs)
                .preferredColorScheme(.dark)
                .tint(.accent)
                .onChange(of: phase) { _, now in
                    if now == .active { link.cameBack() } else if now == .background { link.wentAway() }
                }
        }
        .backgroundTask(.appRefresh(Lookout.checkTask)) { [link] in await link.check() }
    }
}

struct RootView: View {
    @Environment(LinkClient.self) private var link
    @Environment(TabState.self) private var tabs

    private func tab(_ which: AppTab, @ViewBuilder content: () -> some View) -> some View {
        content()
            .opacity(tabs.current == which ? 1 : 0)
            .allowsHitTesting(tabs.current == which)
            .accessibilityHidden(tabs.current != which)
    }

    var body: some View {
        ZStack {
            Color.ground.ignoresSafeArea()
            screens
        }
        .modifier(NotchIslandLayer())
    }

    @ViewBuilder private var screens: some View {
        if link.pairing == nil {
            PairView()
        } else {
            ZStack {
                tab(.fairy) { NavigationStack { HomeView() } }
                tab(.chat) { NavigationStack { ChatTab() } }
                tab(.study) { StudyTab() }
                tab(.tasks) {
                    NavigationStack { TasksView() }
                        .overlay { if link.reach != .connected && link.reach != .connecting { OutOfReachView() } }
                }
                tab(.make) { NavigationStack { MakeView() } }
            }
            .task {
                if link.overview == nil { link.start() }
                await link.lookout.askToAlert()
                if await link.lookout.alertsAllowed() { UIApplication.shared.registerForRemoteNotifications() }
            }
            .onOpenURL { if $0.host == "work" { tabs.current = .tasks } }
        }
    }
}
