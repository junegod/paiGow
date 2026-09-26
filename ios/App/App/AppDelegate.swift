import UIKit
import Capacitor

/// 打索子 iOS 生命周期入口；网页游戏由 Capacitor 的本地资源容器承载。
@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    /// 当前应用窗口，由主界面故事板创建。
    var window: UIWindow?

    /// 接受系统启动，数据初始化交给网页层已有的本地存储流程。
    /// - Parameters:
    ///   - application: 系统应用实例。
    ///   - launchOptions: 系统提供的启动上下文，普通启动时可能为空。
    /// - Returns: 是否完成启动初始化。
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    /// 将系统打开链接事件交给 Capacitor；不另建链接解析逻辑。
    /// - Parameters:
    ///   - app: 系统应用实例。
    ///   - url: 系统请求打开的地址。
    ///   - options: 打开方式及来源信息。
    /// - Returns: Capacitor 是否接收该链接。
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    /// 统一转交系统用户活动，保持与 Capacitor 插件的生命周期兼容。
    /// - Parameters:
    ///   - application: 系统应用实例。
    ///   - userActivity: 系统恢复的活动。
    ///   - restorationHandler: 系统提供的恢复回调。
    /// - Returns: Capacitor 是否处理该活动。
    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
