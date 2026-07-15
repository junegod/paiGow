# 在此添加当前应用专用的 ProGuard 规则。
# 可以通过 build.gradle 中的 proguardFiles 配置控制启用的规则文件。
#
# 更多说明参考：
#   http://developer.android.com/guide/developing/tools/proguard.html

# 如果 WebView 通过 JavaScript 接口调用原生代码，可启用以下规则，
# 并将示例类名替换为 JavaScript 接口类的全限定名：
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# 如需在调试堆栈中保留源码行号，可以启用下一行。
#-keepattributes SourceFile,LineNumberTable

# 保留源码行号后，如需隐藏原始源码文件名，可以启用下一行。
#-renamesourcefileattribute SourceFile
