#import <Foundation/Foundation.h>
#import <objc/message.h>

// Sparkle is loaded from the signed app bundle so ordinary Rust tests and
// non-macOS hosts never require its framework at link time.
static id updaterController;

bool graph_studio_sparkle_start(void) {
    if (![NSThread isMainThread]) return false;
    if (updaterController) return true;

    NSString *frameworks = [[NSBundle mainBundle] privateFrameworksPath];
    if (!frameworks) return false;
    NSBundle *sparkle = [NSBundle bundleWithPath:[frameworks stringByAppendingPathComponent:@"Sparkle.framework"]];
    if (!sparkle || ![sparkle load]) return false;

    Class controllerClass = NSClassFromString(@"SPUStandardUpdaterController");
    SEL initializer = NSSelectorFromString(@"initWithStartingUpdater:updaterDelegate:userDriverDelegate:");
    if (!controllerClass || ![controllerClass instancesRespondToSelector:initializer]) return false;
    id (*initialize)(id, SEL, BOOL, id, id) = (id (*)(id, SEL, BOOL, id, id))objc_msgSend;
    id controller = initialize([controllerClass alloc], initializer, NO, nil, nil);
    if (!controller) return false;
    id (*getUpdater)(id, SEL) = (id (*)(id, SEL))objc_msgSend;
    id updater = getUpdater(controller, NSSelectorFromString(@"updater"));
    if (!updater) return false;
    BOOL (*start)(id, SEL, NSError **) = (BOOL (*)(id, SEL, NSError **))objc_msgSend;
    NSError *error = nil;
    if (!start(updater, NSSelectorFromString(@"startUpdater:"), &error)) {
        NSLog(@"Mere Graph Studio could not start Sparkle: %@", error);
        return false;
    }
    updaterController = controller;
    return true;
}

bool graph_studio_sparkle_check_for_updates(void) {
    if (![NSThread isMainThread] || !updaterController) return false;
    SEL action = NSSelectorFromString(@"checkForUpdates:");
    if (![updaterController respondsToSelector:action]) return false;
    void (*check)(id, SEL, id) = (void (*)(id, SEL, id))objc_msgSend;
    check(updaterController, action, nil);
    return true;
}
