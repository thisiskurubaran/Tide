#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^TideOutputHandler)(NSString *runId, NSString *kind, NSString *text);
typedef void (^TideExitHandler)(NSInteger code, BOOL killed);

// Kept free of Python headers so Swift can import it without the CPython module map.
@interface TidePython : NSObject

+ (nullable NSString *)pythonVersionAndReturnError:(NSError **)error;
+ (nullable NSString *)runSnippet:(NSString *)code error:(NSError **)error;

// Receives output from every run, already batched. Called on a background queue.
+ (void)setOutputHandler:(TideOutputHandler)handler;

// Starts `entry` as __main__ on a new thread. `completion` runs once it exits,
// after all of its output has been passed to the output handler.
+ (void)runWithId:(NSString *)runId
            entry:(NSString *)entry
              cwd:(NSString *)cwd
             args:(NSArray<NSString *> *)args
       extraPaths:(NSArray<NSString *> *)extraPaths
        purgeRoot:(NSString *)purgeRoot
       completion:(TideExitHandler)completion;

+ (void)feed:(NSString *)runId data:(NSString *)data;
+ (void)endInput:(NSString *)runId;
+ (void)kill:(NSString *)runId;

@end

NS_ASSUME_NONNULL_END
